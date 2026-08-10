import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileReadResult, FileWriteRequest } from "../../shared/types";

export type FileServiceErrorCode =
  | "PATH_OUTSIDE_PROJECT"
  | "PROJECT_ROOT_OPERATION"
  | "CONCURRENT_CHANGE"
  | "UNSUPPORTED_ENCODING"
  | "DESTINATION_EXISTS"
  | "TRASH_UNAVAILABLE";

export class FileServiceError extends Error {
  constructor(message: string, public readonly code: FileServiceErrorCode, public readonly path?: string) {
    super(message);
    this.name = "FileServiceError";
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function hashFile(path: string): Promise<string> {
  return sha256Bytes(await readFile(path));
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export function resolveProjectPath(projectRoot: string, candidate: string, allowRoot = false): string {
  const root = resolve(projectRoot);
  const result = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const relation = relative(root, result);
  if (!isInside(root, result)) {
    throw new FileServiceError(`Path escapes the project root: ${candidate}`, "PATH_OUTSIDE_PROJECT", result);
  }
  if (!allowRoot && relation === "") {
    throw new FileServiceError("The project root itself cannot be changed by a file operation.", "PROJECT_ROOT_OPERATION", result);
  }
  return result;
}

async function nearestExisting(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function assertRealPathInside(projectRoot: string, path: string): Promise<void> {
  const [rootRealPath, existingAncestor] = await Promise.all([realpath(projectRoot), nearestExisting(path)]);
  const ancestorRealPath = await realpath(existingAncestor);
  if (!isInside(rootRealPath, ancestorRealPath)) {
    throw new FileServiceError(`A symbolic link resolves outside the project root: ${path}`, "PATH_OUTSIDE_PROJECT", path);
  }
}

function decodeUtf8(bytes: Buffer, path: string): Pick<FileReadResult, "content" | "encoding" | "lineEnding"> {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new FileServiceError("UTF-16 files are read-only because converting them could lose data.", "UNSUPPORTED_ENCODING", path);
  }
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
    if (content.includes("\0")) throw new Error("NUL byte");
    const crlfCount = content.match(/\r\n/g)?.length ?? 0;
    const lfCount = content.match(/(^|[^\r])\n/g)?.length ?? 0;
    return {
      content,
      encoding: hasBom ? "utf8-bom" : "utf8",
      lineEnding: crlfCount > 0 && crlfCount >= lfCount ? "crlf" : "lf"
    };
  } catch {
    throw new FileServiceError("Only valid UTF-8 and UTF-8 BOM text files can be edited.", "UNSUPPORTED_ENCODING", path);
  }
}

function encodePreserving(content: string, encoding: FileReadResult["encoding"], lineEnding: FileReadResult["lineEnding"]): Buffer {
  const lf = content.replace(/\r\n?/g, "\n");
  const normalized = lineEnding === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;
  const body = Buffer.from(normalized, "utf8");
  return encoding === "utf8-bom" ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

export async function readProjectFile(projectRoot: string, path: string): Promise<FileReadResult> {
  const root = resolve(projectRoot);
  const absolutePath = resolveProjectPath(root, path);
  await assertRealPathInside(root, absolutePath);
  const [bytes, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  const decoded = decodeUtf8(bytes, absolutePath);
  return {
    path: absolutePath,
    ...decoded,
    hash: sha256Bytes(bytes),
    mtimeMs: metadata.mtimeMs
  };
}

async function currentHash(path: string): Promise<string> {
  try {
    return await hashFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function hashesMatch(expected: string, actual: string): boolean {
  return expected.toLowerCase() === actual.toLowerCase();
}

export async function writeProjectFile(request: FileWriteRequest): Promise<FileReadResult> {
  const root = resolve(request.projectRoot);
  const absolutePath = resolveProjectPath(root, request.path);
  await assertRealPathInside(root, absolutePath);
  const beforeHash = await currentHash(absolutePath);
  if (!hashesMatch(request.expectedHash, beforeHash)) {
    throw new FileServiceError("The file changed outside LaTeX Workbench. Reload it before saving.", "CONCURRENT_CHANGE", absolutePath);
  }

  let encoding: FileReadResult["encoding"] = "utf8";
  let lineEnding: FileReadResult["lineEnding"] = request.content.includes("\r\n") ? "crlf" : "lf";
  if (beforeHash) {
    const existing = await readProjectFile(root, absolutePath);
    encoding = existing.encoding;
    lineEnding = existing.lineEnding;
  }

  const bytes = encodePreserving(request.content, encoding, lineEnding);
  const parent = dirname(absolutePath);
  await mkdir(parent, { recursive: true });
  await assertRealPathInside(root, parent);
  const temporaryPath = join(parent, `.${basename(absolutePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (!hashesMatch(request.expectedHash, await currentHash(absolutePath))) {
      throw new FileServiceError("The file changed while it was being saved.", "CONCURRENT_CHANGE", absolutePath);
    }
    await rename(temporaryPath, absolutePath);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) await rm(temporaryPath, { force: true });
  }

  return readProjectFile(root, absolutePath);
}

async function destinationMustNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new FileServiceError("The destination already exists.", "DESTINATION_EXISTS", path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function moveProjectPath(
  projectRoot: string,
  fromPath: string,
  toPath: string,
  expectedHash?: string
): Promise<void> {
  const root = resolve(projectRoot);
  const source = resolveProjectPath(root, fromPath);
  const destination = resolveProjectPath(root, toPath);
  await Promise.all([
    assertRealPathInside(root, source),
    assertRealPathInside(root, dirname(destination)),
    destinationMustNotExist(destination)
  ]);
  const sourceMetadata = await lstat(source);
  if (expectedHash !== undefined) {
    if (!sourceMetadata.isFile() || !hashesMatch(expectedHash, await hashFile(source))) {
      throw new FileServiceError("The source changed before the move could be applied.", "CONCURRENT_CHANGE", source);
    }
  }
  if (sourceMetadata.isDirectory() && isInside(source, destination)) {
    throw new FileServiceError("A directory cannot be moved inside itself.", "PATH_OUTSIDE_PROJECT", destination);
  }
  await mkdir(dirname(destination), { recursive: true });
  await rename(source, destination);
}

export const renameProjectPath = moveProjectPath;

export type TrashItem = (path: string) => Promise<void>;

async function electronTrashItem(path: string): Promise<void> {
  try {
    const electron = await import("electron");
    await electron.shell.trashItem(path);
  } catch (error) {
    throw new FileServiceError(
      `The operating-system recycle bin is unavailable; nothing was deleted (${String(error)}).`,
      "TRASH_UNAVAILABLE",
      path
    );
  }
}

export async function trashProjectPath(projectRoot: string, path: string, trashItem: TrashItem = electronTrashItem): Promise<void> {
  const root = resolve(projectRoot);
  const absolutePath = resolveProjectPath(root, path);
  await assertRealPathInside(root, absolutePath);
  await lstat(absolutePath);
  await trashItem(absolutePath);
}

export class ProjectFileService {
  constructor(private readonly trashItem: TrashItem = electronTrashItem) {}

  read(projectRoot: string, path: string): Promise<FileReadResult> {
    return readProjectFile(projectRoot, path);
  }

  write(request: FileWriteRequest): Promise<FileReadResult> {
    return writeProjectFile(request);
  }

  rename(projectRoot: string, fromPath: string, toPath: string, expectedHash?: string): Promise<void> {
    return renameProjectPath(projectRoot, fromPath, toPath, expectedHash);
  }

  move(projectRoot: string, fromPath: string, toPath: string, expectedHash?: string): Promise<void> {
    return moveProjectPath(projectRoot, fromPath, toPath, expectedHash);
  }

  trash(projectRoot: string, path: string): Promise<void> {
    return trashProjectPath(projectRoot, path, this.trashItem);
  }
}

export const readFileSafe = readProjectFile;
export const writeFileSafe = writeProjectFile;
export const moveFileSafe = moveProjectPath;
export const trashFileSafe = trashProjectPath;
