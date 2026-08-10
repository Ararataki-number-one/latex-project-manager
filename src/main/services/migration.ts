import { copyFile, lstat, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { MANAGED_MARKERS, MANIFEST_DIRECTORY } from "../../shared/constants";
import { parseProjectManifest } from "../../shared/schema";
import type { MigrationChange, MigrationPreview, ProjectManifest } from "../../shared/types";
import {
  ConcurrentFileChangeError,
  readTextFile,
  writeFileAtomic,
  writeTextFileAtomic
} from "./encoding";
import { hashesEqual, nonce, sha256 } from "./hashing";
import {
  createManifestFromEntry,
  getManifestPath,
  readProjectManifestIfExists,
  writeProjectManifest
} from "./manifest";
import {
  isSafeRelativePath,
  maskLatexComments,
  parseTexSource,
  resolveProjectPath,
  type ParsedTexDocument
} from "./scanner";

type ManagedSection = keyof typeof MANAGED_MARKERS;

interface SourceEdit {
  section: ManagedSection;
  start: number;
  end: number;
  before: string;
  after: string;
}

interface SnapshotFile {
  relativePath: string;
  backupName: string;
  existed: boolean;
  hash?: string;
  appliedHash?: string | null;
}

interface SnapshotMetadata {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  projectRoot: string;
  files: SnapshotFile[];
}

export interface MigrationSnapshotInfo {
  id: string;
  createdAt: string;
  files: string[];
}

export class DamagedManagedBlockError extends Error {
  constructor(public readonly section: string, message: string) {
    super(`受管区块 ${section} 已损坏：${message}`);
    this.name = "DamagedManagedBlockError";
  }
}

function canonicalEquals(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function canonicalProjectRoot(projectRoot: string): Promise<string> {
  const root = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory()) throw new Error(`项目根路径不是目录: ${root}`);
  return root;
}

function relativeSlash(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

async function normalizeEntry(projectRoot: string, entryPath: string): Promise<{ relativePath: string; absolutePath: string }> {
  const absolutePath = isAbsolute(entryPath) ? resolve(entryPath) : resolveProjectPath(projectRoot, entryPath);
  const relativePath = relativeSlash(projectRoot, absolutePath);
  const checkedPath = resolveProjectPath(projectRoot, relativePath);
  const info = await lstat(checkedPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`主 TeX 必须是项目内的普通文件: ${entryPath}`);
  const canonicalEntry = await realpath(checkedPath);
  const canonicalRelative = relativeSlash(projectRoot, canonicalEntry);
  const canonicalChecked = resolveProjectPath(projectRoot, canonicalRelative);
  if (!canonicalEquals(canonicalChecked, canonicalEntry)) throw new Error(`主 TeX 文件离开了项目根目录: ${entryPath}`);
  return { relativePath, absolutePath: checkedPath };
}

function occurrences(source: string, value: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (from <= source.length) {
    const position = source.indexOf(value, from);
    if (position < 0) break;
    positions.push(position);
    from = position + value.length;
  }
  return positions;
}

function validateManagedMarkers(source: string): Set<ManagedSection> {
  const present = new Set<ManagedSection>();
  const regions: Array<{ section: ManagedSection; start: number; end: number }> = [];

  for (const section of Object.keys(MANAGED_MARKERS) as ManagedSection[]) {
    const markers = MANAGED_MARKERS[section];
    const begins = occurrences(source, markers.begin);
    const ends = occurrences(source, markers.end);
    if (begins.length === 0 && ends.length === 0) continue;
    if (begins.length !== 1 || ends.length !== 1) {
      throw new DamagedManagedBlockError(section, "开始或结束标记缺失/重复");
    }
    if (ends[0] < begins[0] + markers.begin.length) {
      throw new DamagedManagedBlockError(section, "结束标记位于开始标记之前");
    }
    present.add(section);
    regions.push({ section, start: begins[0], end: ends[0] + markers.end.length });
  }

  regions.sort((left, right) => left.start - right.start);
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].start < regions[index - 1].end) {
      throw new DamagedManagedBlockError(regions[index].section, "受管区块相互嵌套或重叠");
    }
  }
  return present;
}

function lineEndingFor(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function wrap(markers: { begin: string; end: string }, value: string, eol: string): string {
  return `${markers.begin}${eol}${value}${eol}${markers.end}`;
}

function packageEdit(source: string, parsed: ParsedTexDocument, present: Set<ManagedSection>): SourceEdit | null {
  if (present.has("packages")) return null;
  const preambleEnd = parsed.documentBegin?.start ?? source.length;
  const declarations = parsed.packageDeclarations
    .filter((item) => !item.conditional && item.end <= preambleEnd)
    .sort((left, right) => left.start - right.start);
  if (declarations.length === 0) return null;

  for (let index = 1; index < declarations.length; index += 1) {
    const gap = source.slice(declarations[index - 1].end, declarations[index].start);
    if (maskLatexComments(gap).trim().length > 0) return null;
  }

  const start = declarations[0].start;
  const end = declarations.at(-1)!.end;
  const before = source.slice(start, end);
  return {
    section: "packages",
    start,
    end,
    before,
    after: wrap(MANAGED_MARKERS.packages, before, lineEndingFor(source))
  };
}

function classEdit(source: string, parsed: ParsedTexDocument, present: Set<ManagedSection>): SourceEdit | null {
  if (present.has("class") || !parsed.classDeclaration) return null;
  const declaration = parsed.classDeclaration;
  return {
    section: "class",
    start: declaration.start,
    end: declaration.end,
    before: declaration.raw,
    after: wrap(MANAGED_MARKERS.class, declaration.raw, lineEndingFor(source))
  };
}

function bodyCanBeManaged(source: string, parsed: ParsedTexDocument): boolean {
  if (!parsed.documentBegin || !parsed.documentEnd || parsed.documentEnd.start < parsed.documentBegin.end) return false;
  const start = parsed.documentBegin.end;
  const end = parsed.documentEnd.start;
  const chars = [...maskLatexComments(source.slice(start, end))];

  for (const command of parsed.structureCommands) {
    if (command.start < start || command.end > end) continue;
    for (let index = command.start - start; index < command.end - start; index += 1) chars[index] = " ";
  }

  const remainder = chars
    .join("")
    .replace(/\\(?:clearpage|cleardoublepage|newpage)\b/g, "")
    .replace(/\\(?:pagestyle|thispagestyle|pagenumbering|includeonly)\s*\{[^{}]*\}/g, "")
    .replace(/\\setcounter\s*\{[^{}]*\}\s*\{[^{}]*\}/g, "")
    .replace(/\\nocite\s*\{[^{}]*\}/g, "");
  return remainder.trim().length === 0;
}

function structureEdit(source: string, parsed: ParsedTexDocument, present: Set<ManagedSection>): SourceEdit | null {
  if (present.has("structure") || !bodyCanBeManaged(source, parsed)) return null;
  const start = parsed.documentBegin!.end;
  const end = parsed.documentEnd!.start;
  const before = source.slice(start, end);
  const eol = lineEndingFor(source);
  return {
    section: "structure",
    start,
    end,
    before,
    after: `${eol}${MANAGED_MARKERS.structure.begin}${/^\r?\n/.test(before) ? "" : eol}${before}${/\r?\n$/.test(before) ? "" : eol}${MANAGED_MARKERS.structure.end}${eol}`
  };
}

function sourceEdits(source: string, parsed: ParsedTexDocument): { edits: SourceEdit[]; warnings: string[] } {
  const present = validateManagedMarkers(source);
  const warnings = [...parsed.warnings];
  const edits = [classEdit(source, parsed, present), packageEdit(source, parsed, present), structureEdit(source, parsed, present)].filter(
    (edit): edit is SourceEdit => edit !== null
  );

  if (!present.has("packages")) {
    if (parsed.packageDeclarations.some((item) => item.conditional)) {
      warnings.push("条件分支中的 \\usepackage 保持为手工代码，不会被工作台接管。");
    }
    if (parsed.packageDeclarations.some((item) => !item.conditional) && !edits.some((item) => item.section === "packages")) {
      warnings.push("宏包声明之间包含自定义代码；为避免改变加载语义，宏包区块保持原样。");
    }
  }
  if (!present.has("structure") && !edits.some((item) => item.section === "structure")) {
    warnings.push("document 环境包含正文或无法识别的命令；为避免扩大接管范围，结构区块保持原样。");
  }
  return { edits, warnings };
}

function changeFromEdit(edit: SourceEdit): MigrationChange {
  const labels: Record<ManagedSection, string> = {
    class: "接管文档类选项",
    packages: "接管连续的宏包声明",
    structure: "接管文档结构骨架"
  };
  return {
    id: edit.section,
    section: edit.section,
    label: labels[edit.section],
    before: edit.before,
    after: edit.after,
    selected: true,
    confidence: edit.section === "structure" ? "medium" : "high"
  };
}

async function previewManifest(
  projectRoot: string,
  entryRelativePath: string,
  projectId?: string
): Promise<{ manifest: ProjectManifest; change?: MigrationChange }> {
  const existing = await readProjectManifestIfExists(projectRoot);
  if (existing?.targets.some((target) => target.entry.replace(/\\/g, "/") === entryRelativePath.replace(/\\/g, "/"))) {
    return { manifest: existing };
  }

  const generated = await createManifestFromEntry(projectRoot, entryRelativePath, existing?.name, existing?.projectId ?? projectId);
  const manifest: ProjectManifest = existing
    ? parseProjectManifest({
        ...existing,
        updatedAt: generated.updatedAt,
        targets: [...existing.targets, ...generated.targets],
        assets: [...new Map([...existing.assets, ...generated.assets].map((asset) => [asset.id, asset])).values()]
      })
    : generated;
  return {
    manifest,
    change: {
      id: "manifest",
      section: "manifest",
      label: existing ? "向项目清单添加文档目标" : "创建项目清单",
      before: existing ? `${JSON.stringify(existing, null, 2)}\n` : "",
      after: `${JSON.stringify(manifest, null, 2)}\n`,
      selected: true,
      confidence: "high"
    }
  };
}

export async function previewMigration(projectRoot: string, entryPath: string, projectId?: string): Promise<MigrationPreview> {
  const root = await canonicalProjectRoot(projectRoot);
  const entry = await normalizeEntry(root, entryPath);
  const source = await readTextFile(entry.absolutePath);
  const parsed = parseTexSource(source.content);
  if (!parsed.classDeclaration || !parsed.hasDocumentBegin) {
    throw new Error("迁移入口必须包含未注释的 \\documentclass 和 document 环境。");
  }
  const prepared = sourceEdits(source.content, parsed);
  const manifest = await previewManifest(root, entry.relativePath, projectId);
  return {
    projectRoot: root,
    entryPath: entry.relativePath,
    sourceHash: source.hash,
    manifest: manifest.manifest,
    changes: [...prepared.edits.map(changeFromEdit), ...(manifest.change ? [manifest.change] : [])],
    warnings: prepared.warnings
  };
}

function applySelectedEdits(source: string, edits: SourceEdit[], selected: Set<string>): string {
  let result = source;
  for (const edit of edits
    .filter((item) => selected.has(item.section))
    .sort((left, right) => right.start - left.start)) {
    if (result.slice(edit.start, edit.end) !== edit.before) {
      throw new ConcurrentFileChangeError("迁移源文件");
    }
    result = `${result.slice(0, edit.start)}${edit.after}${result.slice(edit.end)}`;
  }
  return result;
}

async function snapshotFile(
  projectRoot: string,
  snapshotDirectory: string,
  absolutePath: string,
  backupName: string
): Promise<SnapshotFile> {
  const relativePath = relativeSlash(projectRoot, absolutePath);
  resolveProjectPath(projectRoot, relativePath);
  try {
    const fileInfo = await lstat(absolutePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error(`不能快照非普通文件: ${relativePath}`);
    const bytes = await readFile(absolutePath);
    await writeFileAtomic(resolve(snapshotDirectory, backupName), bytes);
    return { relativePath, backupName, existed: true, hash: sha256(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { relativePath, backupName, existed: false };
    throw error;
  }
}

async function currentFileHash(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Snapshot target is not a regular file: ${path}`);
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function expectedStateMatches(actual: string | null, expected: string | null): boolean {
  if (actual === null || expected === null) return actual === expected;
  return hashesEqual(actual, expected);
}

function isStrictSnapshotRelativePath(value: string): boolean {
  if (!isSafeRelativePath(value)) return false;
  const segments = value.replace(/\\/g, "/").split("/");
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== ".");
}

/**
 * Snapshot paths are persisted on disk and must be treated as untrusted input.
 * Check both lexical containment and symlink-free parents before touching a
 * destination. This keeps a damaged snapshot from redirecting a restore out
 * of the project root.
 */
async function safeSnapshotDestination(projectRoot: string, relativePath: string): Promise<string> {
  if (!isStrictSnapshotRelativePath(relativePath)) {
    throw new Error(`Snapshot path is not a safe project-relative path: ${relativePath}`);
  }
  const destination = resolveProjectPath(projectRoot, relativePath);
  const root = resolve(projectRoot);
  const parentRelative = relative(root, resolve(destination, ".."));
  let cursor = root;
  for (const segment of parentRelative.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Snapshot destination parent is not a regular directory: ${cursor}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink()) throw new Error(`Snapshot destination is a symbolic link: ${relativePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return destination;
}

async function assertSnapshotStorage(projectRoot: string, snapshotId: string): Promise<string> {
  const managedDirectory = resolve(projectRoot, MANIFEST_DIRECTORY);
  const snapshotsDirectory = resolve(managedDirectory, "snapshots");
  for (const directory of [managedDirectory, snapshotsDirectory]) {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Snapshot storage is not a regular directory: ${directory}`);
    }
  }
  const snapshotDirectory = resolve(snapshotsDirectory, snapshotId);
  const snapshotInfo = await lstat(snapshotDirectory);
  if (snapshotInfo.isSymbolicLink() || !snapshotInfo.isDirectory()) {
    throw new Error(`Snapshot directory is not a regular directory: ${snapshotId}`);
  }
  return snapshotDirectory;
}

async function removeFileIfExpected(path: string, expected: string): Promise<void> {
  const actual = await currentFileHash(path);
  if (!expectedStateMatches(actual, expected)) throw new ConcurrentFileChangeError(path);
  await rm(path, { force: true });
  if ((await currentFileHash(path)) !== null) throw new ConcurrentFileChangeError(path);
}

async function writeSnapshotMetadata(directory: string, metadata: SnapshotMetadata): Promise<void> {
  await writeTextFileAtomic(resolve(directory, "snapshot.json"), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    lineEnding: "lf",
    normalizeLineEndings: true
  });
}

async function createMigrationSnapshot(projectRoot: string, files: string[]): Promise<SnapshotMetadata> {
  const snapshotsRoot = resolve(projectRoot, MANIFEST_DIRECTORY, "snapshots");
  try {
    const managedInfo = await lstat(resolve(projectRoot, MANIFEST_DIRECTORY));
    if (managedInfo.isSymbolicLink()) throw new Error(`${MANIFEST_DIRECTORY} 不能是符号链接。`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(snapshotsRoot, { recursive: true });
  const snapshotRootInfo = await lstat(snapshotsRoot);
  if (snapshotRootInfo.isSymbolicLink()) throw new Error("快照目录不能是符号链接。");

  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nonce(4)}`;
  const directory = resolve(snapshotsRoot, id);
  await mkdir(directory, { recursive: false });
  const snapshots = await Promise.all(
    files.map((filePath, index) => snapshotFile(projectRoot, directory, filePath, `file-${index}.bin`))
  );
  const metadata: SnapshotMetadata = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    projectRoot,
    files: snapshots
  };
  await writeSnapshotMetadata(directory, metadata);
  return metadata;
}

interface RestoreOptions {
  expectedCurrent?: Map<string, string | null>;
  onlyPaths?: Set<string>;
}

async function restoreSnapshot(projectRoot: string, metadata: SnapshotMetadata, options: RestoreOptions = {}): Promise<void> {
  if (!canonicalEquals(projectRoot, metadata.projectRoot)) throw new Error("快照不属于当前项目。");
  const directory = await assertSnapshotStorage(projectRoot, metadata.id);
  const files = metadata.files.filter((file) => !options.onlyPaths || options.onlyPaths.has(file.relativePath));
  for (const file of files) {
    const destination = await safeSnapshotDestination(projectRoot, file.relativePath);
    if (options.expectedCurrent) {
      if (!options.expectedCurrent.has(file.relativePath)) {
        throw new Error(`Missing expected checksum for snapshot path: ${file.relativePath}`);
      }
      const expected = options.expectedCurrent.get(file.relativePath)!;
      if (!expectedStateMatches(await currentFileHash(destination), expected)) {
        throw new ConcurrentFileChangeError(destination);
      }
    }
    if (file.existed && (!file.hash || !/^[a-f0-9]{64}$/i.test(file.hash))) {
      throw new Error(`Snapshot checksum is missing: ${file.relativePath}`);
    }
    if (!file.existed) continue;
    const backup = resolve(directory, file.backupName);
    const backupInfo = await lstat(backup);
    if (!backupInfo.isFile() || backupInfo.isSymbolicLink()) throw new Error(`Snapshot backup is not a regular file: ${file.backupName}`);
    const backupBytes = await readFile(backup);
    if (file.hash && !hashesEqual(file.hash, sha256(backupBytes))) throw new Error(`snapshot checksum failed: ${file.relativePath}`);
  }
  for (const file of files) {
    const destination = await safeSnapshotDestination(projectRoot, file.relativePath);
    if (!file.existed) {
      if (options.expectedCurrent) {
        const expected = options.expectedCurrent.get(file.relativePath);
        // A null expected state means the file is already absent. Never issue
        // an unguarded delete in that case; an external file must remain intact.
        if (expected === null) continue;
        if (expected === undefined) throw new Error(`Missing expected checksum for snapshot path: ${file.relativePath}`);
        await removeFileIfExpected(destination, expected);
      } else {
        throw new Error(`Refusing to delete an unguarded snapshot path: ${file.relativePath}`);
      }
      continue;
    }
    const bytes = await readFile(resolve(directory, file.backupName));
    if (file.hash && !hashesEqual(file.hash, sha256(bytes))) throw new Error(`快照校验失败: ${file.relativePath}`);
    await writeFileAtomic(destination, bytes, options.expectedCurrent?.get(file.relativePath));
  }
}

export async function applyMigration(
  suppliedPreview: MigrationPreview,
  selectedChangeIds: string[]
): Promise<ProjectManifest> {
  const root = await canonicalProjectRoot(suppliedPreview.projectRoot);
  const entry = await normalizeEntry(root, suppliedPreview.entryPath);
  const source = await readTextFile(entry.absolutePath);
  if (!hashesEqual(source.hash, suppliedPreview.sourceHash)) throw new ConcurrentFileChangeError(entry.absolutePath);

  // Recompute all edits and the manifest in the trusted main process; renderer-provided diff text is never applied.
  const freshPreview = await previewMigration(root, entry.relativePath, suppliedPreview.manifest.projectId);
  if (!hashesEqual(freshPreview.sourceHash, suppliedPreview.sourceHash)) throw new ConcurrentFileChangeError(entry.absolutePath);
  const allowedIds = new Set(freshPreview.changes.map((change) => change.id));
  const selected = new Set(selectedChangeIds.filter((id) => allowedIds.has(id)));
  const parsed = parseTexSource(source.content);
  const prepared = sourceEdits(source.content, parsed);
  const nextSource = applySelectedEdits(source.content, prepared.edits, selected);
  const sourceChanged = nextSource !== source.content;
  const manifestChanged = selected.has("manifest");
  const manifestPath = getManifestPath(root);
  const existingManifest = await readProjectManifestIfExists(root);
  const manifestChangeOffered = freshPreview.changes.some((change) => change.id === "manifest");

  if (!sourceChanged && !manifestChanged) {
    if (manifestChangeOffered && !existingManifest) {
      throw new Error("Select the manifest change before applying migration to a project without a manifest.");
    }
    return existingManifest ?? freshPreview.manifest;
  }
  if (!manifestChanged && (!existingManifest || (manifestChangeOffered && sourceChanged))) {
    throw new Error("The project manifest must be applied together with this migration.");
  }

  let manifestHash: string | null = null;
  try {
    manifestHash = (await readTextFile(manifestPath)).hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const snapshotFiles = [
    ...(sourceChanged ? [entry.absolutePath] : []),
    ...(manifestChanged ? [manifestPath] : [])
  ];
  const snapshot = await createMigrationSnapshot(root, snapshotFiles);
  const appliedHashes = new Map<string, string | null>();

  try {
    if (sourceChanged) {
      const written = await writeTextFileAtomic(entry.absolutePath, nextSource, {
        encoding: source.encoding,
        lineEnding: source.lineEnding,
        expectedHash: source.hash,
        normalizeLineEndings: false
      });
      appliedHashes.set(relativeSlash(root, entry.absolutePath), written.hash);
    }
    if (manifestChanged) {
      await writeProjectManifest(root, freshPreview.manifest, manifestHash);
      appliedHashes.set(relativeSlash(root, manifestPath), sha256(Buffer.from(`${JSON.stringify(freshPreview.manifest, null, 2)}\n`, "utf8")));
    }
    const appliedMetadata: SnapshotMetadata = {
      ...snapshot,
      files: snapshot.files.map((file) => ({ ...file, appliedHash: appliedHashes.get(file.relativePath) ?? null }))
    };
    await writeSnapshotMetadata(resolve(root, MANIFEST_DIRECTORY, "snapshots", snapshot.id), appliedMetadata);
    return manifestChanged ? freshPreview.manifest : existingManifest!;
  } catch (error) {
    if (appliedHashes.size) {
      try {
        await restoreSnapshot(root, snapshot, { expectedCurrent: appliedHashes, onlyPaths: new Set(appliedHashes.keys()) });
      } catch (restoreError) {
        throw new Error(`Migration failed and rollback was refused because a file changed externally: ${String(restoreError)}`);
      }
    }
    throw error;
  }
}

function parseSnapshotMetadata(value: unknown): SnapshotMetadata {
  if (!value || typeof value !== "object") throw new Error("快照元数据无效。");
  const candidate = value as Partial<SnapshotMetadata>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.id !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.projectRoot !== "string" ||
    !Array.isArray(candidate.files)
  ) {
    throw new Error("快照元数据无效。");
  }
  if (!isAbsolute(candidate.projectRoot) || resolve(candidate.projectRoot) !== candidate.projectRoot) {
    throw new Error("快照项目根路径必须是规范绝对路径。");
  }
  const relativePaths = new Set<string>();
  const backupNames = new Set<string>();
  for (const file of candidate.files) {
    if (
      !file ||
      typeof file.relativePath !== "string" ||
      typeof file.backupName !== "string" ||
      typeof file.existed !== "boolean" ||
      !/^file-\d+\.bin$/.test(file.backupName) ||
      !isStrictSnapshotRelativePath(file.relativePath) ||
      relativePaths.has(file.relativePath.replace(/\\/g, "/")) ||
      backupNames.has(file.backupName) ||
      (file.hash !== undefined && !/^[a-f0-9]{64}$/i.test(file.hash)) ||
      (file.appliedHash !== undefined && file.appliedHash !== null && !/^[a-f0-9]{64}$/i.test(file.appliedHash))
    ) {
      throw new Error("快照文件记录无效。");
    }
    relativePaths.add(file.relativePath.replace(/\\/g, "/"));
    backupNames.add(file.backupName);
  }
  return candidate as SnapshotMetadata;
}

export async function rollbackMigration(projectRoot: string, snapshotId: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(snapshotId)) throw new Error("快照 ID 无效。");
  const root = await canonicalProjectRoot(projectRoot);
  const snapshotDirectory = await assertSnapshotStorage(root, snapshotId);
  const metadataPath = resolve(snapshotDirectory, "snapshot.json");
  const metadata = parseSnapshotMetadata(JSON.parse(await readFile(metadataPath, "utf8")));
  if (metadata.id !== snapshotId) throw new Error("快照 ID 不匹配。");
  const expectedCurrent = new Map<string, string | null>();
  for (const file of metadata.files) {
    if (file.appliedHash === undefined) {
      throw new Error("This snapshot predates guarded rollback; refusing to overwrite files without a post-apply checksum.");
    }
    if (file.existed && file.appliedHash === null) {
      throw new Error(`Snapshot is missing the post-apply checksum for an existing file: ${file.relativePath}`);
    }
    expectedCurrent.set(file.relativePath, file.appliedHash);
  }
  await restoreSnapshot(root, metadata, { expectedCurrent });
}

export const createMigrationPreview = previewMigration;
export const migrateProject = applyMigration;
export const rollback = rollbackMigration;
