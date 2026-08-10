import { afterEach, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProjectManifest } from "../src/shared/types";
import { writeProjectManifest } from "../src/main/services/manifest";
import { profileBuildDirectoryPath } from "../src/main/services/profile-runtime";
import { ProjectOperationsService } from "../src/main/services/project-operations";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "latex-workbench-project-operations-"));
  temporaryDirectories.push(path);
  return path;
}

function manifest(projectId = "project-original"): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId,
    name: "原项目",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    targets: [
      {
        id: "target-main",
        name: "main",
        entry: "main.tex",
        engine: "auto",
        classConfig: { name: "book", options: {}, rawOptions: [] },
        packages: [],
        structure: [],
        profiles: [
          {
            id: "profile-full",
            name: "完整文档",
            chapterState: {},
            numbering: "preserve",
            enabledBlocks: {},
            order: []
          },
          {
            id: "profile-short",
            name: "摘要",
            chapterState: {},
            numbering: "continuous",
            enabledBlocks: {},
            order: []
          }
        ]
      }
    ],
    assets: []
  };
}

async function createManagedProject(root: string): Promise<void> {
  await mkdir(join(root, "章节"), { recursive: true });
  await writeFile(join(root, "main.tex"), "\\documentclass{book}\n\\begin{document}正文\\end{document}\n", "utf8");
  await writeFile(join(root, "章节", "第一章.tex"), "第一章\n", "utf8");
  await writeProjectManifest(root, manifest());
}

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = bytes.lastIndexOf(endSignature);
  if (endOffset < 0) throw new Error("ZIP end record not found");
  const count = bytes.readUInt16LE(endOffset + 10);
  let centralOffset = bytes.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    expect(bytes.readUInt32LE(centralOffset)).toBe(0x02014b50);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const nameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const localOffset = bytes.readUInt32LE(centralOffset + 42);
    const name = bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");
    expect(bytes.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, inflateRawSync(bytes.subarray(dataOffset, dataOffset + compressedSize)));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe("project management filesystem operations", () => {
  it("copies a project atomically, omits caches, and assigns a new manifest identity", async () => {
    const base = await temporaryDirectory();
    const source = join(base, "source");
    const destinationParent = join(base, "copies");
    await mkdir(destinationParent);
    await createManagedProject(source);
    await mkdir(join(source, ".git"));
    await writeFile(join(source, ".git", "config"), "private history", "utf8");
    await writeFile(join(source, "main.log"), "generated", "utf8");
    await writeFile(join(source, "references.bbl"), "required bibliography", "utf8");
    await writeFile(join(source, "index.ist"), "required index style", "utf8");
    await mkdir(join(source, ".latex-workbench", "build", "target-main", "profile-full"), { recursive: true });
    await writeFile(join(source, ".latex-workbench", "build", "target-main", "profile-full", "last-success.pdf"), "pdf");

    const service = new ProjectOperationsService();
    const copied = await service.copy(source, destinationParent, "副本");

    expect(copied.rootPath).toBe(join(destinationParent, "副本"));
    expect(await readFile(join(copied.rootPath, "章节", "第一章.tex"), "utf8")).toBe("第一章\n");
    expect(copied.manifest?.projectId).not.toBe("project-original");
    expect(copied.manifest?.name).toBe("副本");
    await expect(stat(join(copied.rootPath, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(copied.rootPath, "main.log"), "utf8")).toBe("generated");
    expect(await readFile(join(copied.rootPath, "references.bbl"), "utf8")).toBe("required bibliography");
    expect(await readFile(join(copied.rootPath, "index.ist"), "utf8")).toBe("required index style");
    await expect(stat(join(copied.rootPath, ".latex-workbench", "build"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("streams a Unicode ZIP archive and preserves ordinary project files", async () => {
    const base = await temporaryDirectory();
    const source = join(base, "概率方法");
    await createManagedProject(source);
    await writeFile(join(source, "main.aux"), "generated", "utf8");
    await writeFile(join(source, "references.bbl"), "required bibliography", "utf8");
    await writeFile(join(source, "index.ist"), "required index style", "utf8");
    const destination = join(base, "导出.zip");

    await new ProjectOperationsService().exportZip(source, destination);
    const entries = readZipEntries(await readFile(destination));

    expect(entries.get("main.tex")?.toString("utf8")).toContain("正文");
    expect(entries.get("章节/第一章.tex")?.toString("utf8")).toBe("第一章\n");
    expect(entries.has(".latex-workbench/project.json")).toBe(true);
    expect(entries.get("main.aux")?.toString("utf8")).toBe("generated");
    expect(entries.get("references.bbl")?.toString("utf8")).toBe("required bibliography");
    expect(entries.get("index.ist")?.toString("utf8")).toBe("required index style");
    if (process.platform === "win32") {
      const tarPath = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
      const listed = await execFileAsync(tarPath, ["-tf", destination], { windowsHide: true });
      expect(listed.stdout).toContain("main.tex");
    }
  });

  it("recognizes the non-empty PDF generated beside a manifest target entry", async () => {
    const root = await temporaryDirectory();
    await createManagedProject(root);
    const mainPdf = join(root, "main.pdf");
    await writeFile(mainPdf, "%PDF-formal-output");

    const info = await new ProjectOperationsService().lastSuccessfulPdf(root, manifest());

    expect(info).toMatchObject({
      path: mainPdf,
      size: Buffer.byteLength("%PDF-formal-output"),
      targetId: "target-main"
    });
    expect(info?.profileId).toBeUndefined();
  });

  it("returns a trusted main PDF without descending into an unsafe fallback tree", async () => {
    const base = await temporaryDirectory();
    const root = join(base, "project");
    const outside = join(base, "outside");
    await createManagedProject(root);
    await mkdir(outside);
    await mkdir(join(root, "huge-tree"));
    await symlink(outside, join(root, "huge-tree", "main.pdf"), process.platform === "win32" ? "junction" : "dir");
    const mainPdf = join(root, "main.pdf");
    await writeFile(mainPdf, "trusted-main");

    expect(await new ProjectOperationsService().lastSuccessfulPdf(root, manifest())).toMatchObject({
      path: mainPdf,
      targetId: "target-main"
    });
  });

  it("chooses the newest PDF between the entry directory and a trusted output directory", async () => {
    const root = await temporaryDirectory();
    await createManagedProject(root);
    const rootPdf = join(root, "main.pdf");
    const outputPdf = join(root, "out", "main.pdf");
    await mkdir(join(root, "out"));
    await writeFile(rootPdf, "root-old");
    await writeFile(outputPdf, "output-new");
    await utimes(rootPdf, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    await utimes(outputPdf, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));

    const service = new ProjectOperationsService();
    expect(await service.lastSuccessfulPdf(root, manifest())).toMatchObject({ path: outputPdf, targetId: "target-main" });

    await writeFile(rootPdf, "root-updated");
    await utimes(rootPdf, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"));
    expect(await service.lastSuccessfulPdf(root, manifest())).toMatchObject({ path: rootPdf, targetId: "target-main" });
  });

  it("uses mtime between equally preferred target PDFs and ignores exported copies", async () => {
    const root = await temporaryDirectory();
    await createManagedProject(root);
    await writeFile(join(root, "handout.tex"), "\\documentclass{article}\n\\begin{document}x\\end{document}\n", "utf8");
    const multiTarget = manifest();
    multiTarget.targets.push({
      ...multiTarget.targets[0],
      id: "target-handout",
      name: "handout",
      entry: "handout.tex",
      profiles: multiTarget.targets[0].profiles.map((profile, index) => ({
        ...profile,
        id: `handout-profile-${index}`
      }))
    });
    const mainPdf = join(root, "main.pdf");
    const handoutPdf = join(root, "handout.pdf");
    await writeFile(mainPdf, "main-v1");
    await writeFile(handoutPdf, "handout-v1");
    await mkdir(join(root, "exports"));
    await writeFile(join(root, "exports", "main.pdf"), "unrelated-export");
    await utimes(mainPdf, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    await utimes(handoutPdf, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));

    const service = new ProjectOperationsService();
    expect(await service.lastSuccessfulPdf(root, multiTarget)).toMatchObject({
      path: handoutPdf,
      targetId: "target-handout"
    });

    await writeFile(mainPdf, "main-v2");
    await utimes(mainPdf, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"));
    expect(await service.lastSuccessfulPdf(root, multiTarget)).toMatchObject({
      path: mainPdf,
      targetId: "target-main"
    });
  });

  it("does not treat an arbitrary exported copy as the target build output", async () => {
    const root = await temporaryDirectory();
    await createManagedProject(root);
    await mkdir(join(root, "exports"));
    await mkdir(join(root, "figures"));
    await writeFile(join(root, "exports", "main.pdf"), "exported-copy");
    await writeFile(join(root, "figures", "main.pdf"), "figure-copy");

    expect(await new ProjectOperationsService().lastSuccessfulPdf(root, manifest())).toBeNull();
  });

  it("finds the newest last-success PDF across profiles", async () => {
    const root = await temporaryDirectory();
    await createManagedProject(root);
    const projectManifest = manifest();
    const fullDirectory = profileBuildDirectoryPath(root, "target-main", "profile-full");
    const shortDirectory = profileBuildDirectoryPath(root, "target-main", "profile-short");
    await mkdir(fullDirectory, { recursive: true });
    await mkdir(shortDirectory, { recursive: true });
    const oldPdf = join(fullDirectory, "last-success.pdf");
    const newestPdf = join(shortDirectory, "last-success.pdf");
    await writeFile(oldPdf, "old-pdf");
    await writeFile(newestPdf, "new-pdf");
    await utimes(oldPdf, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    await utimes(newestPdf, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    const emptyPdf = join(root, ".latex-workbench", "build", "other", "empty", "last-success.pdf");
    await mkdir(join(root, ".latex-workbench", "build", "other", "empty"), { recursive: true });
    await writeFile(emptyPdf, "");
    await utimes(emptyPdf, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"));

    const service = new ProjectOperationsService();
    const info = await service.lastSuccessfulPdf(root, projectManifest);
    expect(info).toMatchObject({ path: newestPdf, targetId: "target-main", profileId: "profile-short" });
  });

  it("normalizes export extensions and refuses to write ZIP or PDF files inside the project", async () => {
    const base = await temporaryDirectory();
    const root = join(base, "project");
    await createManagedProject(root);
    const sourcePdf = join(root, "main.pdf");
    await writeFile(sourcePdf, "formal-pdf");
    const service = new ProjectOperationsService();

    const zipOutput = await service.exportZip(root, join(base, "backup"));
    expect(zipOutput).toBe(join(base, "backup.zip"));
    expect((await stat(zipOutput)).size).toBeGreaterThan(0);
    const pdfOutput = await service.exportPdf(root, sourcePdf, join(base, "formal-output"));
    expect(pdfOutput).toBe(join(base, "formal-output.pdf"));
    expect(await readFile(pdfOutput, "utf8")).toBe("formal-pdf");

    await expect(service.exportZip(root, join(root, "self-backup"))).rejects.toThrow("outside the project directory");
    await expect(service.exportPdf(root, sourcePdf, join(root, "main-copy"))).rejects.toThrow("outside the project directory");
  });
});
