import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectCatalog } from "../src/main/services/catalog";
import {
  ConcurrentFileChangeError,
  readTextFile,
  writeTextFileAtomic
} from "../src/main/services/encoding";
import { parseTexSource, scanLibrary } from "../src/main/services/scanner";
import { parseProjectManifest } from "../src/shared/schema";
import type { ProjectManifest, ProjectSummary } from "../src/shared/types";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "latex-workbench-core-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function validManifest(): ProjectManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId: "project-test",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    targets: [
      {
        id: "target-main",
        name: "main",
        entry: "main.tex",
        engine: "auto",
        classConfig: { name: "book", options: {}, rawOptions: [] },
        packages: [],
        structure: [
          {
            id: "node-one",
            kind: "chapter",
            title: "One",
            path: "chapters/one.tex",
            phase: "mainmatter",
            order: 0,
            managed: true
          }
        ],
        profiles: [
          {
            id: "profile-full",
            name: "Full",
            chapterState: { "node-one": "full" },
            numbering: "preserve",
            enabledBlocks: {},
            order: ["node-one"]
          }
        ]
      }
    ],
    assets: []
  };
}

describe("manifest schema", () => {
  it("accepts a valid manifest and rejects path traversal", () => {
    expect(parseProjectManifest(validManifest()).projectId).toBe("project-test");
    const invalid = structuredClone(validManifest());
    invalid.targets[0].entry = "../outside.tex";
    expect(() => parseProjectManifest(invalid)).toThrow(/路径/);
  });

  it("rejects profile references to unknown nodes", () => {
    const invalid = structuredClone(validManifest());
    invalid.targets[0].profiles[0].order.push("node-missing");
    expect(() => parseProjectManifest(invalid)).toThrow(/不存在的结构节点/);
  });
});

describe("encoding and hashing", () => {
  it("preserves UTF-8 BOM and CRLF during guarded writes", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "main.tex");
    await writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("one\r\ntwo\r\n")]));

    const before = await readTextFile(filePath);
    expect(before.encoding).toBe("utf8-bom");
    expect(before.lineEnding).toBe("crlf");
    await writeTextFileAtomic(filePath, `${before.content}three\r\n`, {
      encoding: before.encoding,
      lineEnding: before.lineEnding,
      expectedHash: before.hash
    });
    const bytes = await readFile(filePath);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain("one\r\ntwo\r\nthree\r\n");
  });

  it("refuses a stale expected hash", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "main.tex");
    await writeFile(filePath, "first");
    const snapshot = await readTextFile(filePath);
    await writeFile(filePath, "external change");
    await expect(
      writeTextFileAtomic(filePath, "ours", { expectedHash: snapshot.hash })
    ).rejects.toBeInstanceOf(ConcurrentFileChangeError);
  });
});

describe("scanner", () => {
  it("ignores comments and records magic engine, class options, conditional packages and structure", () => {
    const parsed = parseTexSource(String.raw`% !TeX program = xelatex
% \documentclass{fake}
\documentclass[lang=cn,color=blue]{elegantbook}
\usepackage{amsmath,booktabs}
\ifdefined\draft
  \usepackage{showframe}
\fi
\begin{document}
\mainmatter
\input{chapters/one}
\chapter{Inline}
\end{document}`);

    expect(parsed.magicEngine).toBe("xelatex");
    expect(parsed.classDeclaration).toMatchObject({
      name: "elegantbook",
      options: ["lang=cn", "color=blue"]
    });
    expect(parsed.packageDeclarations).toHaveLength(2);
    expect(parsed.packageDeclarations[1]).toMatchObject({ conditional: true });
    expect(parsed.includeDeclarations[0]).toMatchObject({ command: "input", path: "chapters/one" });
    expect(parsed.structureCommands.map((item) => item.kind)).toEqual(["mainmatter", "input", "chapter"]);
  });

  it("finds only actual main documents within the configured depth", async () => {
    const root = await temporaryDirectory();
    const project = join(root, "project");
    await mkdir(join(project, "chapters"), { recursive: true });
    await writeFile(join(project, "main.tex"), "\\documentclass{book}\n\\begin{document}x\\end{document}\n");
    await writeFile(join(project, "chapters", "one.tex"), "\\chapter{One}\n");
    const candidates = await scanLibrary(root, { maxDepth: 3 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].entries.map((entry) => entry.relativePath)).toEqual(["main.tex"]);
  });
});

describe("catalog fallback", () => {
  it("continues with an in-memory index when SQLite cannot be opened", async () => {
    const root = await temporaryDirectory();
    const blocker = join(root, "blocker");
    await writeFile(blocker, "not a directory");
    const catalog = new ProjectCatalog(join(blocker, "catalog.db"));
    expect(catalog.persistent).toBe(false);
    const summary: ProjectSummary = {
      id: "project-test",
      name: "Test",
      rootPath: root,
      targetCount: 1,
      classNames: ["book"],
      favorite: false,
      archived: false,
      trashed: false,
      tags: ["notes"],
      pathAvailable: true
    };
    catalog.upsert(summary);
    expect(catalog.list()).toMatchObject([{ id: "project-test", pathAvailable: true }]);
    expect(catalog.update("project-test", { favorite: true }).favorite).toBe(true);
  });
});

describe("catalog persistence", () => {
  it("persists project metadata in SQLite across catalog instances", async () => {
    const root = await temporaryDirectory();
    const databasePath = join(root, "state", "catalog.db");
    const summary: ProjectSummary = {
      id: "project-persistent",
      name: "Persistent",
      rootPath: root,
      targetCount: 2,
      classNames: ["elegantbook"],
      favorite: true,
      archived: false,
      trashed: false,
      tags: ["probability"],
      pathAvailable: true
    };

    const first = new ProjectCatalog(databasePath);
    expect(first.persistent).toBe(true);
    first.upsert(summary);
    first.close();

    const reopened = new ProjectCatalog(databasePath);
    expect(reopened.list()).toMatchObject([
      {
        id: "project-persistent",
        favorite: true,
        classNames: ["elegantbook"],
        tags: ["probability"]
      }
    ]);
    reopened.close();
  });
});
