import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConcurrentFileChangeError } from "../src/main/services/encoding";
import { applyMigration, previewMigration, rollbackMigration } from "../src/main/services/migration";
import { readProjectManifest } from "../src/main/services/manifest";
import { MANAGED_MARKERS } from "../src/shared/constants";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ root: string; entry: string; original: Buffer }> {
  const root = await mkdtemp(join(tmpdir(), "latex-workbench-migration-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "chapters"), { recursive: true });
  const content = [
    "% !TeX program = xelatex",
    "\\documentclass[lang=cn,color=blue]{elegantbook}",
    "\\usepackage{amsmath}",
    "\\usepackage[table]{xcolor}",
    "\\begin{document}",
    "\\frontmatter",
    "\\tableofcontents",
    "\\mainmatter",
    "\\input{chapters/one}",
    "\\end{document}",
    ""
  ].join("\r\n");
  const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)]);
  const entry = join(root, "main.tex");
  await writeFile(entry, original);
  await writeFile(join(root, "chapters", "one.tex"), "\\chapter{First chapter}\r\nText.\r\n");
  return { root, entry, original };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("managed migration", () => {
  it("previews, snapshots and applies managed blocks without changing BOM/CRLF", async () => {
    const { root, entry, original } = await fixture();
    const preview = await previewMigration(root, "main.tex");
    expect(preview.changes.map((change) => change.id)).toEqual(["class", "packages", "structure", "manifest"]);
    expect(preview.manifest.targets[0].structure.some((node) => node.title === "First chapter")).toBe(true);

    await applyMigration(preview, preview.changes.map((change) => change.id));
    const migrated = await readFile(entry);
    expect([...migrated.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const migratedText = migrated.toString("utf8");
    expect(migratedText).toContain(MANAGED_MARKERS.class.begin);
    expect(migratedText).toContain(MANAGED_MARKERS.packages.begin);
    expect(migratedText).toContain(MANAGED_MARKERS.structure.begin);
    expect(migratedText.replace(/\r\n/g, "")).not.toContain("\n");
    expect((await readProjectManifest(root)).targets[0].engine).toBe("xelatex");

    const secondPreview = await previewMigration(root, "main.tex");
    expect(secondPreview.changes).toEqual([]);

    const snapshotIds = await readdir(join(root, ".latex-workbench", "snapshots"));
    expect(snapshotIds).toHaveLength(1);
    await rollbackMigration(root, snapshotIds[0]);
    expect(await readFile(entry)).toEqual(original);
    await expect(readProjectManifest(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops when the source changed after preview", async () => {
    const { root, entry } = await fixture();
    const preview = await previewMigration(root, "main.tex");
    await writeFile(entry, `${(await readFile(entry)).toString("utf8")}% external\r\n`);
    await expect(applyMigration(preview, ["class"])).rejects.toBeInstanceOf(ConcurrentFileChangeError);
  });

  it("refuses to roll back over an external edit made after apply", async () => {
    const { root, entry } = await fixture();
    const preview = await previewMigration(root, "main.tex");
    await applyMigration(preview, preview.changes.map((change) => change.id));
    const snapshotIds = await readdir(join(root, ".latex-workbench", "snapshots"));
    await writeFile(entry, `${(await readFile(entry)).toString("utf8")}external\n`, "utf8");
    await expect(rollbackMigration(root, snapshotIds[0])).rejects.toBeInstanceOf(ConcurrentFileChangeError);
    expect((await readFile(entry)).toString("utf8")).toContain("external");
  });

  it("requires the manifest change when applying source takeover to a new project", async () => {
    const { root } = await fixture();
    const preview = await previewMigration(root, "main.tex");
    await expect(applyMigration(preview, ["class"])).rejects.toThrow(/manifest/i);
  });

  it("does not offer package or structure takeover for ambiguous source", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-workbench-conservative-"));
    temporaryDirectories.push(root);
    await writeFile(
      join(root, "main.tex"),
      "\\documentclass{book}\n\\usepackage{a}\n\\newcommand{\\x}{x}\n\\usepackage{b}\n" +
        "\\begin{document}\nFree text.\n\\input{chapter}\n\\end{document}\n"
    );
    await writeFile(join(root, "chapter.tex"), "\\chapter{One}\n");
    const preview = await previewMigration(root, "main.tex");
    expect(preview.changes.map((change) => change.id)).toEqual(["class", "manifest"]);
    expect(preview.warnings.join(" ")).toMatch(/宏包声明/);
    expect(preview.warnings.join(" ")).toMatch(/document 环境/);
  });

  it("requires the manifest change when migrating a project for the first time", async () => {
    const { root } = await fixture();
    const preview = await previewMigration(root, "main.tex");
    await expect(applyMigration(preview, ["class", "packages", "structure"]))
      .rejects.toThrow(/manifest/);
  });

  it("refuses an explicit rollback after an external edit", async () => {
    const { root, entry } = await fixture();
    const preview = await previewMigration(root, "main.tex");
    await applyMigration(preview, preview.changes.map((change) => change.id));
    const snapshotIds = await readdir(join(root, ".latex-workbench", "snapshots"));
    await writeFile(entry, `${(await readFile(entry)).toString("utf8")}external\r\n`);
    await expect(rollbackMigration(root, snapshotIds[0])).rejects.toBeInstanceOf(ConcurrentFileChangeError);
  });
});
