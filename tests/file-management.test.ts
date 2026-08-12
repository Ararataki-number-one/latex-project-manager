import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileServiceError, ProjectFileService, resolveProjectPath } from "../src/main/services/files";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "latex-workbench-files-"));
  roots.push(root);
  await mkdir(join(root, "chapters"), { recursive: true });
  return root;
}

describe("managed project files", () => {
  it("rejects path traversal and operations on the project root", async () => {
    const root = await projectRoot();
    expect(() => resolveProjectPath(root, "../outside.tex")).toThrowError(FileServiceError);
    expect(() => resolveProjectPath(root, ".")).toThrowError(FileServiceError);
  });

  it("previews and applies a literal LaTeX reference rewrite, preserving BOM and CRLF", async () => {
    const root = await projectRoot();
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const main = Buffer.concat([bom, Buffer.from("\\documentclass{book}\r\n\\input{chapters/old}\r\n", "utf8")]);
    await writeFile(join(root, "main.tex"), main);
    await writeFile(join(root, "chapters", "old.tex"), "正文\n", "utf8");

    const service = new ProjectFileService(async () => undefined);
    const plan = await service.plan(root, {
      kind: "rename",
      sourcePath: "chapters/old.tex",
      destinationPath: "chapters/new.tex",
      rewriteLatexReferences: true
    });

    expect(plan.referenceChanges).toMatchObject([
      { filePath: "main.tex", oldReference: "chapters/old", newReference: "chapters/new", occurrences: 1 }
    ]);
    const result = await service.apply(root, plan.id);
    expect(await readFile(join(root, "chapters", "new.tex"), "utf8")).toBe("正文\n");
    await expect(stat(join(root, "chapters", "old.tex"))).rejects.toMatchObject({ code: "ENOENT" });
    const rewritten = await readFile(join(root, "main.tex"));
    expect(rewritten.subarray(0, 3)).toEqual(bom);
    expect(rewritten.toString("utf8")).toContain("\\input{chapters/new}\r\n");

    await service.undo(root, result.undoId);
    expect(await readFile(join(root, "chapters", "old.tex"), "utf8")).toBe("正文\n");
    expect(await readFile(join(root, "main.tex"))).toEqual(main);
  });

  it("stops an operation when the source changes after preview", async () => {
    const root = await projectRoot();
    await writeFile(join(root, "chapters", "old.tex"), "v1\n", "utf8");
    const service = new ProjectFileService(async () => undefined);
    const plan = await service.plan(root, {
      kind: "move",
      sourcePath: "chapters/old.tex",
      destinationPath: "old.tex"
    });
    await writeFile(join(root, "chapters", "old.tex"), "externally changed\n", "utf8");

    await expect(service.apply(root, plan.id)).rejects.toMatchObject({ code: "CONCURRENT_CHANGE" });
    expect(await readFile(join(root, "chapters", "old.tex"), "utf8")).toBe("externally changed\n");
    await expect(stat(join(root, "old.tex"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("copies without rewriting references and can undo through the recycle-bin adapter", async () => {
    const root = await projectRoot();
    await writeFile(join(root, "main.tex"), "\\input{chapters/source}\n", "utf8");
    await writeFile(join(root, "chapters", "source.tex"), "copy me\n", "utf8");
    const trashed: string[] = [];
    const service = new ProjectFileService(async (path) => { trashed.push(path); await rm(path, { recursive: true, force: true }); });
    const plan = await service.plan(root, {
      kind: "copy",
      sourcePath: "chapters/source.tex",
      destinationPath: "chapters/copy.tex",
      rewriteLatexReferences: true
    });
    expect(plan.referenceChanges).toEqual([]);
    const result = await service.apply(root, plan.id);
    expect(await readFile(join(root, "chapters", "copy.tex"), "utf8")).toBe("copy me\n");
    expect(await readFile(join(root, "main.tex"), "utf8")).toContain("chapters/source");

    await service.undo(root, result.undoId);
    expect(trashed).toContain(join(root, "chapters", "copy.tex"));
    await expect(stat(join(root, "chapters", "copy.tex"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
