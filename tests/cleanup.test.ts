import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TemporaryCleanupService } from "../src/main/services/cleanup";
import { ProjectStorageService } from "../src/main/services/project-storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "latex-workbench-cleanup-"));
  temporaryDirectories.push(root);
  await Promise.all([
    mkdir(join(root, "references"), { recursive: true }),
    mkdir(join(root, ".git"), { recursive: true }),
    mkdir(join(root, ".latex-workbench", "build", "book", "full"), { recursive: true }),
    mkdir(join(root, ".latex-workbench", "snapshots"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(root, "main.tex"), "source", "utf8"),
    writeFile(join(root, "main.pdf"), "compiled-pdf", "utf8"),
    writeFile(join(root, "main.aux"), "aux", "utf8"),
    writeFile(join(root, "main.log"), "log", "utf8"),
    writeFile(join(root, "references", "paper.pdf"), "reference", "utf8"),
    writeFile(join(root, ".git", "objects.bin"), "git-data", "utf8"),
    writeFile(join(root, ".latex-workbench", "build", "book", "full", "wrapper.tex"), "generated", "utf8"),
    writeFile(join(root, ".latex-workbench", "build", "book", "full", "wrapper.aux"), "generated-aux", "utf8"),
    writeFile(join(root, ".latex-workbench", "build", "book", "full", "book.pdf"), "keep-pdf", "utf8"),
    writeFile(join(root, ".latex-workbench", "snapshots", "old.log"), "recovery", "utf8")
  ]);
  return root;
}

describe("temporary-file cleanup", () => {
  it("previews and deletes only known auxiliary files and generated cache", async () => {
    const root = await createFixture();
    const service = new TemporaryCleanupService();
    const preview = await service.preview("project-1", root);

    expect(preview.fileCount).toBe(4);
    expect(preview.categories).toEqual(expect.arrayContaining([
      { name: "LaTeX 辅助文件", count: 2 },
      { name: "工作台构建缓存", count: 2 }
    ]));
    expect(preview.samplePaths).toContain("main.aux");
    expect(preview.samplePaths).not.toContain("main.tex");
    expect(preview.samplePaths).not.toContain("references/paper.pdf");

    const result = await service.apply("project-1", root, preview.planId);
    expect(result.fileCount).toBe(4);
    await expect(stat(join(root, "main.aux"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, "main.log"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("source");
    expect(await readFile(join(root, "main.pdf"), "utf8")).toBe("compiled-pdf");
    expect(await readFile(join(root, "references", "paper.pdf"), "utf8")).toBe("reference");
    expect(await readFile(join(root, ".latex-workbench", "build", "book", "full", "book.pdf"), "utf8")).toBe("keep-pdf");
    expect(await readFile(join(root, ".latex-workbench", "snapshots", "old.log"), "utf8")).toBe("recovery");
  });

  it("stops when a previewed file changes before confirmation", async () => {
    const root = await createFixture();
    const service = new TemporaryCleanupService();
    const preview = await service.preview("project-1", root);
    await writeFile(join(root, "main.aux"), "changed after preview", "utf8");

    await expect(service.apply("project-1", root, preview.planId)).rejects.toThrow(/发生变化/);
    expect(await readFile(join(root, "main.log"), "utf8")).toBe("log");
  });
});

describe("project storage measurement", () => {
  it("counts project content while excluding Git and workbench caches", async () => {
    const root = await createFixture();
    const expected = Buffer.byteLength("source") + Buffer.byteLength("compiled-pdf")
      + Buffer.byteLength("aux") + Buffer.byteLength("log") + Buffer.byteLength("reference");
    const result = await new ProjectStorageService().measure(root);

    expect(result.fileCount).toBe(5);
    expect(result.totalBytes).toBe(expected);
  });
});
