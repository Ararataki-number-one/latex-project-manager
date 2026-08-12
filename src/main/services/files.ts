import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  FileReadResult,
  FileWriteRequest,
  LatexReferenceChange,
  ProjectFileEntry,
  ProjectFileKind,
  ProjectFileListOptions,
  ProjectFileOperationPlan,
  ProjectFileOperationRequest,
  ProjectFileOperationResult,
  ProjectFileUndoResult
} from "../../shared/types";

export type FileServiceErrorCode =
  | "PATH_OUTSIDE_PROJECT"
  | "PROJECT_ROOT_OPERATION"
  | "CONCURRENT_CHANGE"
  | "UNSUPPORTED_ENCODING"
  | "DESTINATION_EXISTS"
  | "TRASH_UNAVAILABLE"
  | "INVALID_NAME"
  | "PLAN_EXPIRED";

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

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function classifyFile(name: string, isDirectory: boolean): ProjectFileKind {
  if (isDirectory) return "directory";
  const extension = extname(name).toLowerCase();
  if ([".tex", ".sty", ".cls", ".ltx"].includes(extension)) return "tex";
  if ([".bib", ".bst"].includes(extension)) return "bib";
  if (extension === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"].includes(extension)) return "image";
  if ([".zip", ".7z", ".rar", ".tar", ".gz"].includes(extension)) return "archive";
  if ([".doc", ".docx", ".odt", ".epub", ".djvu"].includes(extension)) return "document";
  return "other";
}

async function fileEntry(root: string, absolutePath: string): Promise<ProjectFileEntry> {
  const metadata = await lstat(absolutePath);
  const name = basename(absolutePath);
  const isDirectory = metadata.isDirectory();
  return {
    name,
    relativePath: toPosix(relative(root, absolutePath)),
    kind: classifyFile(name, isDirectory),
    isDirectory,
    size: isDirectory ? 0 : metadata.size,
    modifiedAt: metadata.mtime.toISOString(),
    extension: isDirectory ? undefined : extname(name).slice(1).toLowerCase() || undefined,
    hidden: name.startsWith("."),
    hash: !isDirectory && metadata.size <= 8 * 1024 * 1024 ? await hashFile(absolutePath) : undefined
  };
}

async function collectEntries(root: string, directory: string, recursive: boolean, includeHidden: boolean): Promise<ProjectFileEntry[]> {
  const result: ProjectFileEntry[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!includeHidden && item.name.startsWith(".")) continue;
    const absolutePath = join(directory, item.name);
    await assertRealPathInside(root, absolutePath);
    const entry = await fileEntry(root, absolutePath);
    result.push(entry);
    if (recursive && item.isDirectory()) result.push(...await collectEntries(root, absolutePath, true, includeHidden));
  }
  return result;
}

export async function listProjectFiles(projectRoot: string, options: ProjectFileListOptions = {}): Promise<ProjectFileEntry[]> {
  const root = resolve(projectRoot);
  const directory = options.directory ? resolveProjectPath(root, options.directory) : root;
  await assertRealPathInside(root, directory);
  if (!(await lstat(directory)).isDirectory()) throw new FileServiceError("The requested path is not a directory.", "INVALID_NAME", directory);
  let entries = await collectEntries(root, directory, Boolean(options.recursive), Boolean(options.includeHidden));
  const query = options.query?.trim().toLocaleLowerCase();
  if (query) entries = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query) || entry.relativePath.toLocaleLowerCase().includes(query));
  const direction = options.direction === "desc" ? -1 : 1;
  const sort = options.sort ?? "name";
  entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    if (sort === "modified") return direction * left.modifiedAt.localeCompare(right.modifiedAt);
    if (sort === "size") return direction * (left.size - right.size);
    if (sort === "type") return direction * left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    return direction * left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
  return entries;
}

function validateName(name: string): string {
  const value = name.trim();
  if (!value || value === "." || value === ".." || /[\\/:*?"<>|\0]/.test(value)) {
    throw new FileServiceError("The file name is empty or contains unsupported characters.", "INVALID_NAME", name);
  }
  return value;
}

export async function createProjectDirectory(projectRoot: string, parentPath: string, name: string): Promise<ProjectFileEntry> {
  const root = resolve(projectRoot);
  const parent = parentPath ? resolveProjectPath(root, parentPath) : root;
  const destination = resolveProjectPath(root, join(parentPath || ".", validateName(name)));
  await assertRealPathInside(root, parent);
  await destinationMustNotExist(destination);
  await mkdir(destination);
  return fileEntry(root, destination);
}

export async function createEmptyProjectFile(projectRoot: string, parentPath: string, name: string): Promise<ProjectFileEntry> {
  const root = resolve(projectRoot);
  const parent = parentPath ? resolveProjectPath(root, parentPath) : root;
  const destination = resolveProjectPath(root, join(parentPath || ".", validateName(name)));
  await assertRealPathInside(root, parent);
  await destinationMustNotExist(destination);
  const handle = await open(destination, "wx", 0o600);
  await handle.close();
  return fileEntry(root, destination);
}

export async function importProjectFiles(projectRoot: string, destinationDirectory: string, sourcePaths: string[]): Promise<ProjectFileEntry[]> {
  const root = resolve(projectRoot);
  const directory = destinationDirectory ? resolveProjectPath(root, destinationDirectory) : root;
  await assertRealPathInside(root, directory);
  const output: ProjectFileEntry[] = [];
  for (const sourcePath of sourcePaths) {
    const sourceMetadata = await lstat(sourcePath);
    if (!sourceMetadata.isFile()) continue;
    const destination = resolveProjectPath(root, join(destinationDirectory || ".", basename(sourcePath)));
    await destinationMustNotExist(destination);
    await copyFile(sourcePath, destination);
    output.push(await fileEntry(root, destination));
  }
  return output;
}

async function snapshotPath(path: string): Promise<{ hash: string; size: number; isDirectory: boolean }> {
  const metadata = await lstat(path);
  if (metadata.isFile()) return { hash: await hashFile(path), size: metadata.size, isDirectory: false };
  if (!metadata.isDirectory()) return { hash: sha256Bytes(Buffer.from(`${metadata.mode}:${metadata.size}`)), size: metadata.size, isDirectory: false };
  const digest = createHash("sha256");
  let size = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(directory, item.name);
      const childRelative = toPosix(relative(path, child));
      digest.update(childRelative);
      if (item.isDirectory()) await walk(child);
      else if (item.isFile()) { const bytes = await readFile(child); size += bytes.length; digest.update(bytes); }
    }
  };
  await walk(path);
  return { hash: digest.digest("hex"), size, isDirectory: true };
}

interface ReferenceEdit extends LatexReferenceChange { content: string; }
interface StoredPlan { root: string; source: string; destination?: string; plan: ProjectFileOperationPlan; edits: ReferenceEdit[]; }
interface UndoRecord {
  root: string;
  kind: ProjectFileOperationPlan["kind"];
  source: string;
  destination?: string;
  backupPath?: string;
  referenceBackups: Array<{ path: string; backup: string; appliedHash: string }>;
}

const referencePattern = /(\\(?:input|include|subfile|includegraphics|bibliography|addbibresource)(?:\[[^\]]*\])?\s*\{)([^{}]+)(\})/g;
const referenceExtensions = new Set([".tex", ".sty", ".cls", ".bib"]);

function normalizedReference(value: string): string { return value.replace(/\\/g, "/").replace(/^\.\//, ""); }
function withoutExtension(value: string): string { const extension = extname(value); return extension ? value.slice(0, -extension.length) : value; }

async function findReferenceEdits(root: string, sourceRel: string, destinationRel: string): Promise<ReferenceEdit[]> {
  const files = (await collectEntries(root, root, true, false)).filter((entry) => !entry.isDirectory && entry.relativePath !== normalizedReference(sourceRel) && referenceExtensions.has(extname(entry.name).toLowerCase()));
  const edits: ReferenceEdit[] = [];
  for (const entry of files) {
    let read: FileReadResult;
    try { read = await readProjectFile(root, entry.relativePath); } catch { continue; }
    let occurrences = 0;
    let oldReference = "";
    let newReference = "";
    const referrerDir = dirname(entry.relativePath).replace(/\\/g, "/");
    const next = read.content.replace(referencePattern, (match, prefix: string, raw: string, suffix: string) => {
      const value = normalizedReference(raw.trim());
      const rootCandidate = value;
      const localCandidate = normalizedReference(join(referrerDir === "." ? "" : referrerDir, value));
      const source = normalizedReference(sourceRel);
      const matches = [rootCandidate, localCandidate].some((candidate) => candidate === source || withoutExtension(candidate) === withoutExtension(source));
      if (!matches) return match;
      const rootStyle = rootCandidate === source || withoutExtension(rootCandidate) === withoutExtension(source);
      let replacement = rootStyle ? normalizedReference(destinationRel) : normalizedReference(relative(referrerDir || ".", destinationRel));
      if (!extname(value) && extname(replacement)) replacement = withoutExtension(replacement);
      occurrences += 1; oldReference ||= raw; newReference ||= replacement;
      return `${prefix}${replacement}${suffix}`;
    });
    if (occurrences > 0 && next !== read.content) edits.push({
      filePath: entry.relativePath, expectedHash: read.hash, occurrences, oldReference, newReference, content: next
    });
  }
  return edits;
}

export class ProjectFileService {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly undoRecords = new Map<string, UndoRecord>();

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

  list(projectRoot: string, options?: ProjectFileListOptions): Promise<ProjectFileEntry[]> {
    return listProjectFiles(projectRoot, options);
  }

  createDirectory(projectRoot: string, parentPath: string, name: string): Promise<ProjectFileEntry> {
    return createProjectDirectory(projectRoot, parentPath, name);
  }

  create(projectRoot: string, parentPath: string, name: string): Promise<ProjectFileEntry> {
    return createEmptyProjectFile(projectRoot, parentPath, name);
  }

  import(projectRoot: string, destinationDirectory: string, sourcePaths: string[]): Promise<ProjectFileEntry[]> {
    return importProjectFiles(projectRoot, destinationDirectory, sourcePaths);
  }

  async plan(projectRoot: string, request: ProjectFileOperationRequest): Promise<ProjectFileOperationPlan> {
    const root = resolve(projectRoot);
    const source = resolveProjectPath(root, request.sourcePath);
    await assertRealPathInside(root, source);
    const snapshot = await snapshotPath(source);
    if (request.expectedHash && !hashesMatch(request.expectedHash, snapshot.hash)) {
      throw new FileServiceError("The source changed before the operation could be previewed.", "CONCURRENT_CHANGE", source);
    }
    let destination: string | undefined;
    if (request.kind !== "trash") {
      if (!request.destinationPath) throw new FileServiceError("This operation needs a destination.", "INVALID_NAME");
      destination = resolveProjectPath(root, request.destinationPath);
      await assertRealPathInside(root, dirname(destination));
      await destinationMustNotExist(destination);
      if (snapshot.isDirectory && isInside(source, destination)) throw new FileServiceError("A directory cannot be placed inside itself.", "PATH_OUTSIDE_PROJECT", destination);
    }
    const sourceRel = toPosix(relative(root, source));
    const destinationRel = destination ? toPosix(relative(root, destination)) : "";
    const edits = destination && request.kind !== "copy" && request.rewriteLatexReferences !== false
      ? await findReferenceEdits(root, sourceRel, destinationRel)
      : [];
    const now = Date.now();
    const plan: ProjectFileOperationPlan = {
      id: randomUUID(), kind: request.kind, sourcePath: sourceRel,
      destinationPath: destination ? destinationRel : undefined,
      sourceHash: snapshot.hash, sourceSize: snapshot.size, isDirectory: snapshot.isDirectory,
      referenceChanges: edits.map(({ content: _content, ...change }) => change),
      warnings: request.kind === "trash" ? ["文件将移入系统回收站；应用会保留一份短期撤销备份。"] : [],
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60_000).toISOString()
    };
    this.plans.set(plan.id, { root, source, destination, plan, edits });
    return plan;
  }

  async apply(projectRoot: string, planId: string): Promise<ProjectFileOperationResult> {
    const root = resolve(projectRoot);
    const stored = this.plans.get(planId);
    if (!stored || stored.root !== root || Date.parse(stored.plan.expiresAt) < Date.now()) {
      this.plans.delete(planId);
      throw new FileServiceError("The preview expired. Preview the operation again.", "PLAN_EXPIRED");
    }
    const current = await snapshotPath(stored.source);
    if (!hashesMatch(stored.plan.sourceHash, current.hash)) throw new FileServiceError("The source changed after preview.", "CONCURRENT_CHANGE", stored.source);
    for (const edit of stored.edits) {
      if (!hashesMatch(edit.expectedHash, await hashFile(resolveProjectPath(root, edit.filePath)))) {
        throw new FileServiceError("A LaTeX file changed after preview.", "CONCURRENT_CHANGE", edit.filePath);
      }
    }
    const undoId = randomUUID();
    const undoRoot = join(root, ".latex-workbench", "undo", undoId);
    await mkdir(undoRoot, { recursive: true });
    const referenceBackups: UndoRecord["referenceBackups"] = [];
    for (const edit of stored.edits) {
      const original = resolveProjectPath(root, edit.filePath);
      const backup = join(undoRoot, "references", edit.filePath);
      await mkdir(dirname(backup), { recursive: true });
      await copyFile(original, backup);
    }
    let backupPath: string | undefined;
    let payloadApplied = false;
    try {
      if (stored.plan.kind === "trash") {
        backupPath = join(undoRoot, "payload", basename(stored.source));
        await mkdir(dirname(backupPath), { recursive: true });
        await cp(stored.source, backupPath, { recursive: true, errorOnExist: true });
        await this.trashItem(stored.source);
        payloadApplied = true;
      } else if (stored.plan.kind === "copy") {
        await cp(stored.source, stored.destination!, { recursive: true, errorOnExist: true });
        payloadApplied = true;
      } else {
        await mkdir(dirname(stored.destination!), { recursive: true });
        await rename(stored.source, stored.destination!);
        payloadApplied = true;
      }
      for (const edit of stored.edits) {
        const written = await writeProjectFile({ projectRoot: root, path: edit.filePath, content: edit.content, expectedHash: edit.expectedHash });
        referenceBackups.push({ path: edit.filePath, backup: join(undoRoot, "references", edit.filePath), appliedHash: written.hash });
      }
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const edit of [...stored.edits].reverse()) {
        try {
          await copyFile(join(undoRoot, "references", edit.filePath), resolveProjectPath(root, edit.filePath));
        } catch (rollbackError) {
          rollbackFailures.push(`${edit.filePath}: ${String(rollbackError)}`);
        }
      }
      try {
        if (stored.plan.kind === "trash" && payloadApplied && backupPath) {
          await destinationMustNotExist(stored.source);
          await cp(backupPath, stored.source, { recursive: true, errorOnExist: true });
        } else if (stored.plan.kind === "copy" && stored.destination) {
          await rm(stored.destination, { recursive: true, force: true });
        } else if (payloadApplied && stored.destination) {
          await destinationMustNotExist(stored.source);
          await rename(stored.destination, stored.source);
        }
      } catch (rollbackError) {
        rollbackFailures.push(`payload: ${String(rollbackError)}`);
      }
      this.plans.delete(planId);
      if (rollbackFailures.length) {
        throw new FileServiceError(`The operation failed and automatic rollback was incomplete: ${rollbackFailures.join("; ")}`, "CONCURRENT_CHANGE", stored.source);
      }
      await rm(undoRoot, { recursive: true, force: true });
      throw error;
    }
    this.undoRecords.set(undoId, { root, kind: stored.plan.kind, source: stored.source, destination: stored.destination, backupPath, referenceBackups });
    this.plans.delete(planId);
    return {
      undoId,
      affectedPaths: [stored.plan.sourcePath, ...(stored.plan.destinationPath ? [stored.plan.destinationPath] : [])],
      rewrittenFiles: stored.edits.map((edit) => edit.filePath),
      operation: stored.plan.kind,
      sourcePath: stored.plan.sourcePath,
      destinationPath: stored.plan.destinationPath,
      undoExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString()
    };
  }

  async undo(projectRoot: string, undoId: string): Promise<ProjectFileUndoResult> {
    const root = resolve(projectRoot);
    const record = this.undoRecords.get(undoId);
    if (!record || record.root !== root) throw new FileServiceError("This undo operation is no longer available.", "PLAN_EXPIRED");
    if (record.kind === "trash") {
      await destinationMustNotExist(record.source);
      await cp(record.backupPath!, record.source, { recursive: true, errorOnExist: true });
    } else if (record.kind === "copy") {
      await this.trashItem(record.destination!);
    } else {
      await destinationMustNotExist(record.source);
      await rename(record.destination!, record.source);
    }
    const revertedReferenceFiles: string[] = [];
    for (const reference of record.referenceBackups) {
      const destination = resolveProjectPath(root, reference.path);
      if (!hashesMatch(reference.appliedHash, await hashFile(destination))) {
        throw new FileServiceError("A rewritten LaTeX reference changed after the operation; undo stopped.", "CONCURRENT_CHANGE", destination);
      }
      await copyFile(reference.backup, destination);
      revertedReferenceFiles.push(reference.path);
    }
    this.undoRecords.delete(undoId);
    return { restoredPaths: [toPosix(relative(root, record.source))], revertedReferenceFiles };
  }
}

export const readFileSafe = readProjectFile;
export const writeFileSafe = writeProjectFile;
export const moveFileSafe = moveProjectPath;
export const trashFileSafe = trashProjectPath;
