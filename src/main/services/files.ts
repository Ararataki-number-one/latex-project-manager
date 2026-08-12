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
  createdAt: string;
  expiresAt: string;
  kind: ProjectFileOperationPlan["kind"];
  source: string;
  destination?: string;
  backupPath?: string;
  payloadHash: string;
  referenceBackups: Array<{ path: string; backup: string; backupHash: string; appliedHash: string }>;
}

interface UndoJournal {
  schemaVersion: 1;
  undoId: string;
  createdAt: string;
  expiresAt: string;
  kind: ProjectFileOperationPlan["kind"];
  sourcePath: string;
  destinationPath?: string;
  backupPath?: string;
  payloadHash: string;
  referenceBackups: Array<{ path: string; backupPath: string; backupHash: string; appliedHash: string }>;
}

const UNDO_TTL_MS = 24 * 60 * 60_000;
const UNDO_JOURNAL_VERSION = 1;
const undoIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/i;

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

  private undoDirectory(root: string, undoId: string): string {
    if (!undoIdPattern.test(undoId)) {
      throw new FileServiceError("This undo operation is no longer available.", "PLAN_EXPIRED");
    }
    return join(root, ".latex-workbench", "undo", undoId);
  }

  private async persistUndoRecord(undoId: string, record: UndoRecord): Promise<void> {
    const undoRoot = this.undoDirectory(record.root, undoId);
    const journal: UndoJournal = {
      schemaVersion: UNDO_JOURNAL_VERSION,
      undoId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      kind: record.kind,
      sourcePath: toPosix(relative(record.root, record.source)),
      destinationPath: record.destination ? toPosix(relative(record.root, record.destination)) : undefined,
      backupPath: record.backupPath ? toPosix(relative(undoRoot, record.backupPath)) : undefined,
      payloadHash: record.payloadHash,
      referenceBackups: record.referenceBackups.map((reference) => ({
        path: reference.path,
        backupPath: toPosix(relative(undoRoot, reference.backup)),
        backupHash: reference.backupHash,
        appliedHash: reference.appliedHash
      }))
    };
    const destination = join(undoRoot, "journal.json");
    const temporary = join(undoRoot, `.journal.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async loadUndoRecord(root: string, undoId: string): Promise<UndoRecord> {
    const cached = this.undoRecords.get(undoId);
    if (cached && cached.root === root && Date.parse(cached.expiresAt) > Date.now()) return cached;
    const undoRoot = this.undoDirectory(root, undoId);
    let journal: UndoJournal;
    try {
      journal = JSON.parse(await readFile(join(undoRoot, "journal.json"), "utf8")) as UndoJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        throw new FileServiceError("This undo operation is no longer available.", "PLAN_EXPIRED");
      }
      throw error;
    }
    const validKind = new Set<ProjectFileOperationPlan["kind"]>(["rename", "move", "copy", "trash"]);
    const expiresAt = Date.parse(journal.expiresAt);
    if (journal.schemaVersion !== UNDO_JOURNAL_VERSION || journal.undoId !== undoId
      || !validKind.has(journal.kind) || !Number.isFinite(expiresAt)
      || !hashPattern.test(journal.payloadHash) || !Array.isArray(journal.referenceBackups)) {
      throw new FileServiceError("This undo operation is no longer available.", "PLAN_EXPIRED");
    }
    if (expiresAt <= Date.now()) {
      await rm(undoRoot, { recursive: true, force: true });
      this.undoRecords.delete(undoId);
      throw new FileServiceError("This undo operation has expired.", "PLAN_EXPIRED");
    }
    const resolveArtifact = (path: string): string => {
      if (typeof path !== "string" || isAbsolute(path)) throw new FileServiceError("The undo journal is invalid.", "PLAN_EXPIRED");
      const result = resolve(undoRoot, path);
      if (!isInside(undoRoot, result) || result === undoRoot) throw new FileServiceError("The undo journal is invalid.", "PLAN_EXPIRED");
      return result;
    };
    const source = resolveProjectPath(root, journal.sourcePath);
    const destination = journal.destinationPath ? resolveProjectPath(root, journal.destinationPath) : undefined;
    if ((journal.kind === "trash") === Boolean(destination)) {
      throw new FileServiceError("The undo journal is invalid.", "PLAN_EXPIRED");
    }
    const referenceBackups = journal.referenceBackups.map((reference) => {
      if (!reference || typeof reference.path !== "string" || !hashPattern.test(reference.backupHash)
        || !hashPattern.test(reference.appliedHash)) {
        throw new FileServiceError("The undo journal is invalid.", "PLAN_EXPIRED");
      }
      resolveProjectPath(root, reference.path);
      return {
        path: reference.path,
        backup: resolveArtifact(reference.backupPath),
        backupHash: reference.backupHash,
        appliedHash: reference.appliedHash
      };
    });
    const record: UndoRecord = {
      root,
      createdAt: journal.createdAt,
      expiresAt: journal.expiresAt,
      kind: journal.kind,
      source,
      destination,
      backupPath: journal.backupPath ? resolveArtifact(journal.backupPath) : undefined,
      payloadHash: journal.payloadHash,
      referenceBackups
    };
    this.undoRecords.set(undoId, record);
    return record;
  }

  private async cleanupExpiredUndo(root: string): Promise<void> {
    const undoBase = join(root, ".latex-workbench", "undo");
    let entries;
    try {
      entries = await readdir(undoBase, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory() || !undoIdPattern.test(entry.name)) continue;
      const directory = join(undoBase, entry.name);
      let expiresAt = Number.NaN;
      try {
        const journal = JSON.parse(await readFile(join(directory, "journal.json"), "utf8")) as Partial<UndoJournal>;
        expiresAt = typeof journal.expiresAt === "string" ? Date.parse(journal.expiresAt) : Number.NaN;
      } catch {
        // Incomplete snapshots are retained for 24 hours before cleanup.
      }
      if (!Number.isFinite(expiresAt)) expiresAt = (await stat(directory)).mtimeMs + UNDO_TTL_MS;
      if (expiresAt <= now) {
        await rm(directory, { recursive: true, force: true });
        this.undoRecords.delete(entry.name);
      }
    }
  }

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
    await this.cleanupExpiredUndo(root);
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
    await this.cleanupExpiredUndo(root);
    const stored = this.plans.get(planId);
    if (!stored || stored.root !== root || Date.parse(stored.plan.expiresAt) < Date.now()) {
      this.plans.delete(planId);
      throw new FileServiceError("The preview expired. Preview the operation again.", "PLAN_EXPIRED");
    }
    await assertRealPathInside(root, stored.source);
    if (stored.destination) {
      await assertRealPathInside(root, dirname(stored.destination));
      await destinationMustNotExist(stored.destination);
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
    const referenceBackupHashes = new Map<string, string>();
    for (const edit of stored.edits) {
      const original = resolveProjectPath(root, edit.filePath);
      const backup = join(undoRoot, "references", edit.filePath);
      await mkdir(dirname(backup), { recursive: true });
      await copyFile(original, backup);
      const backupHash = await hashFile(backup);
      if (!hashesMatch(edit.expectedHash, backupHash)) {
        await rm(undoRoot, { recursive: true, force: true });
        throw new FileServiceError("A LaTeX file changed while its recovery snapshot was being created.", "CONCURRENT_CHANGE", edit.filePath);
      }
      referenceBackupHashes.set(edit.filePath, backupHash);
    }
    let backupPath: string | undefined;
    let payloadApplied = false;
    let copyStagingPath: string | undefined;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + UNDO_TTL_MS).toISOString();
    let undoRecord: UndoRecord | undefined;
    try {
      if (stored.plan.kind === "trash") {
        backupPath = join(undoRoot, "payload", basename(stored.source));
        await mkdir(dirname(backupPath), { recursive: true });
        await cp(stored.source, backupPath, { recursive: true, errorOnExist: true });
        await this.trashItem(stored.source);
        payloadApplied = true;
      } else if (stored.plan.kind === "copy") {
        // Copy into a private sibling first.  `fs.cp` defaults to force=true,
        // which can otherwise overwrite a destination that appeared after the
        // preview.  Publishing the completed staging path with rename keeps a
        // failed copy from ever deleting or altering somebody else's target.
        copyStagingPath = join(
          dirname(stored.destination!),
          `.${basename(stored.destination!)}.${process.pid}.${randomBytes(6).toString("hex")}.copy-tmp`
        );
        await destinationMustNotExist(copyStagingPath);
        await cp(stored.source, copyStagingPath, { recursive: true, errorOnExist: true, force: false });
        const [sourceAfterCopy, stagedCopy] = await Promise.all([
          snapshotPath(stored.source),
          snapshotPath(copyStagingPath)
        ]);
        if (!hashesMatch(stored.plan.sourceHash, sourceAfterCopy.hash)
          || !hashesMatch(stored.plan.sourceHash, stagedCopy.hash)) {
          throw new FileServiceError("The source changed while it was being copied.", "CONCURRENT_CHANGE", stored.source);
        }
        await destinationMustNotExist(stored.destination!);
        await rename(copyStagingPath, stored.destination!);
        copyStagingPath = undefined;
        payloadApplied = true;
      } else {
        await mkdir(dirname(stored.destination!), { recursive: true });
        await rename(stored.source, stored.destination!);
        payloadApplied = true;
      }
      for (const edit of stored.edits) {
        const written = await writeProjectFile({ projectRoot: root, path: edit.filePath, content: edit.content, expectedHash: edit.expectedHash });
        referenceBackups.push({
          path: edit.filePath,
          backup: join(undoRoot, "references", edit.filePath),
          backupHash: referenceBackupHashes.get(edit.filePath)!,
          appliedHash: written.hash
        });
      }
      undoRecord = {
        root,
        createdAt,
        expiresAt,
        kind: stored.plan.kind,
        source: stored.source,
        destination: stored.destination,
        backupPath,
        payloadHash: stored.plan.sourceHash,
        referenceBackups
      };
      await this.persistUndoRecord(undoId, undoRecord);
    } catch (error) {
      if (copyStagingPath) await rm(copyStagingPath, { recursive: true, force: true });
      const rollbackFailures: string[] = [];
      // Validate every path involved in rollback before changing any of them.
      // If VS Code touched even one applied file, keep the recovery snapshot
      // intact and make no rollback mutation rather than overwrite new work.
      for (const reference of referenceBackups) {
        try {
          if (!hashesMatch(reference.appliedHash, await hashFile(resolveProjectPath(root, reference.path)))) {
            rollbackFailures.push(`${reference.path}: changed after it was rewritten`);
          }
          if (!hashesMatch(reference.backupHash, await hashFile(reference.backup))) {
            rollbackFailures.push(`${reference.path}: recovery snapshot changed`);
          }
        } catch (validationError) {
          rollbackFailures.push(`${reference.path}: ${String(validationError)}`);
        }
      }
      if (payloadApplied) {
        try {
          if (stored.plan.kind === "trash") {
            await destinationMustNotExist(stored.source);
            if (!backupPath || !hashesMatch(stored.plan.sourceHash, (await snapshotPath(backupPath)).hash)) {
              rollbackFailures.push("payload: recovery snapshot changed");
            }
          } else if (stored.destination) {
            const destinationSnapshot = await snapshotPath(stored.destination);
            if (!hashesMatch(stored.plan.sourceHash, destinationSnapshot.hash)) {
              rollbackFailures.push("payload: destination changed after the operation");
            }
            if (stored.plan.kind !== "copy") await destinationMustNotExist(stored.source);
          }
        } catch (validationError) {
          rollbackFailures.push(`payload: ${String(validationError)}`);
        }
      }
      this.plans.delete(planId);
      if (rollbackFailures.length) {
        throw new FileServiceError(`The operation failed and automatic rollback was incomplete: ${rollbackFailures.join("; ")}`, "CONCURRENT_CHANGE", stored.source);
      }

      for (const reference of [...referenceBackups].reverse()) {
        await copyFile(reference.backup, resolveProjectPath(root, reference.path));
      }
      if (stored.plan.kind === "trash" && payloadApplied && backupPath) {
        await cp(backupPath, stored.source, { recursive: true, errorOnExist: true, force: false });
      } else if (stored.plan.kind === "copy" && payloadApplied && stored.destination) {
        await rm(stored.destination, { recursive: true, force: true });
      } else if (payloadApplied && stored.destination) {
        await rename(stored.destination, stored.source);
      }
      await rm(undoRoot, { recursive: true, force: true });
      throw error;
    }
    this.undoRecords.set(undoId, undoRecord!);
    this.plans.delete(planId);
    return {
      undoId,
      affectedPaths: [stored.plan.sourcePath, ...(stored.plan.destinationPath ? [stored.plan.destinationPath] : [])],
      rewrittenFiles: stored.edits.map((edit) => edit.filePath),
      operation: stored.plan.kind,
      sourcePath: stored.plan.sourcePath,
      destinationPath: stored.plan.destinationPath,
      undoExpiresAt: expiresAt
    };
  }

  async undo(projectRoot: string, undoId: string): Promise<ProjectFileUndoResult> {
    const root = resolve(projectRoot);
    await this.cleanupExpiredUndo(root);
    const record = await this.loadUndoRecord(root, undoId);

    // Undo is all-or-nothing with respect to external edits: validate every
    // reference and payload before the first restore, move or recycle action.
    for (const reference of record.referenceBackups) {
      const destination = resolveProjectPath(root, reference.path);
      if (!hashesMatch(reference.appliedHash, await hashFile(destination))) {
        throw new FileServiceError("A rewritten LaTeX reference changed after the operation; undo stopped before changing anything.", "CONCURRENT_CHANGE", destination);
      }
      if (!hashesMatch(reference.backupHash, await hashFile(reference.backup))) {
        throw new FileServiceError("A LaTeX recovery snapshot changed; undo stopped before changing anything.", "CONCURRENT_CHANGE", reference.backup);
      }
    }
    if (record.kind === "trash") {
      await destinationMustNotExist(record.source);
      if (!record.backupPath || !hashesMatch(record.payloadHash, (await snapshotPath(record.backupPath)).hash)) {
        throw new FileServiceError("The recovery snapshot changed; undo stopped before changing anything.", "CONCURRENT_CHANGE", record.backupPath);
      }
    } else {
      const destinationSnapshot = await snapshotPath(record.destination!);
      if (!hashesMatch(record.payloadHash, destinationSnapshot.hash)) {
        throw new FileServiceError("The operated file changed after the operation; undo stopped before changing anything.", "CONCURRENT_CHANGE", record.destination);
      }
      if (record.kind !== "copy") await destinationMustNotExist(record.source);
    }

    if (record.kind === "trash") {
      await cp(record.backupPath!, record.source, { recursive: true, errorOnExist: true, force: false });
    } else if (record.kind === "copy") {
      await this.trashItem(record.destination!);
    } else {
      await rename(record.destination!, record.source);
    }
    const revertedReferenceFiles: string[] = [];
    for (const reference of record.referenceBackups) {
      const destination = resolveProjectPath(root, reference.path);
      await copyFile(reference.backup, destination);
      revertedReferenceFiles.push(reference.path);
    }
    this.undoRecords.delete(undoId);
    await rm(this.undoDirectory(root, undoId), { recursive: true, force: true });
    return { restoredPaths: [toPosix(relative(root, record.source))], revertedReferenceFiles };
  }
}

export const readFileSafe = readProjectFile;
export const writeFileSafe = writeProjectFile;
export const moveFileSafe = moveProjectPath;
export const trashFileSafe = trashProjectPath;
