import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ReferenceService } from "../src/main/services/references";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("original manuscript management", () => {
  it("copies source documents into references without overwriting equal names", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-workbench-references-"));
    temporaryDirectories.push(base);
    const root = join(base, "project");
    const sourceA = join(base, "source-a");
    const sourceB = join(base, "source-b");
    await Promise.all([mkdir(root), mkdir(sourceA), mkdir(sourceB)]);
    const first = join(sourceA, "paper.pdf");
    const second = join(sourceB, "paper.pdf");
    await writeFile(first, "first manuscript", "utf8");
    await writeFile(second, "second manuscript", "utf8");
    const opened: string[] = [];
    const removed: string[] = [];
    const service = new ReferenceService({
      openPath: async (path) => { opened.push(path); return ""; },
      trashItem: async (path) => { removed.push(path); await rm(path); }
    });

    const imported = await service.importFiles(root, [first, second]);
    expect(imported.map((item) => item.name).sort()).toEqual(["paper (2).pdf", "paper.pdf"]);
    expect(await readFile(join(root, "references", "paper.pdf"), "utf8")).toBe("first manuscript");
    expect(await readFile(join(root, "references", "paper (2).pdf"), "utf8")).toBe("second manuscript");

    await service.open(root, "references/paper.pdf");
    expect(opened).toEqual([join(root, "references", "paper.pdf")]);
    const remaining = await service.remove(root, "references/paper.pdf");
    expect(removed).toEqual([join(root, "references", "paper.pdf")]);
    expect(remaining.map((item) => item.name)).toEqual(["paper (2).pdf"]);
  });

  it("rejects unsupported files and paths outside the references directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-workbench-references-"));
    temporaryDirectories.push(base);
    const root = join(base, "project");
    await mkdir(root);
    const executable = join(base, "unsafe.exe");
    await writeFile(executable, "not a manuscript", "utf8");
    const service = new ReferenceService();

    await expect(service.importFiles(root, [executable])).rejects.toThrow(/不支持|format/i);
    await service.list(root);
    await expect(service.open(root, "../unsafe.exe")).rejects.toThrow(/越出|outside|无效/i);
  });
});
