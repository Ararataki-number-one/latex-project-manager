import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileServiceError,
  ProjectFileService,
  readProjectFile,
  resolveProjectPath,
  writeProjectFile
} from "../src/main/services/files";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "latex-workbench-files-"));
  temporaryDirectories.push(root);
  return root;
}

describe("project file service", () => {
  it("rejects lexical path traversal", () => {
    expect(() => resolveProjectPath(join(process.cwd(), "book"), join("..", "outside.tex"))).toThrow(FileServiceError);
  });

  it("preserves UTF-8 BOM and CRLF while applying optimistic hash checks", async () => {
    const root = await temporaryProject();
    const path = join(root, "main.tex");
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("one\r\ntwo\r\n")]));
    const before = await readProjectFile(root, path);
    expect(before).toEqual(expect.objectContaining({ encoding: "utf8-bom", lineEnding: "crlf" }));

    const after = await writeProjectFile({ projectRoot: root, path, content: "three\nfour\n", expectedHash: before.hash });
    expect(after).toEqual(expect.objectContaining({ encoding: "utf8-bom", lineEnding: "crlf" }));
    expect(await readFile(path)).toEqual(Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("three\r\nfour\r\n")
    ]));

    await expect(writeProjectFile({ projectRoot: root, path, content: "stale", expectedHash: before.hash }))
      .rejects.toMatchObject({ code: "CONCURRENT_CHANGE" });
  });

  it("delegates deletion to the recycle-bin provider without unlinking directly", async () => {
    const root = await temporaryProject();
    const path = join(root, "chapter.tex");
    await writeFile(path, "chapter", "utf8");
    const trash = vi.fn(async () => undefined);
    const service = new ProjectFileService(trash);
    await service.trash(root, path);
    expect(trash).toHaveBeenCalledWith(path);
    expect(await readFile(path, "utf8")).toBe("chapter");
  });
});
