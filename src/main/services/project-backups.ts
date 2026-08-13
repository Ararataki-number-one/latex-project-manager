import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import type {
  BackupRestoreResult,
  BackupSnapshot,
  BackupVerification,
  CatalogProjectResearchItem,
  ProjectBackupPreview,
  ProjectBackupSettings,
  ProjectSummary
} from "../../shared/types";

interface SnapshotFile {
  path: string;
  size: number;
  sha256: string;
  source: "project" | "localResearch";
  attachmentId?: string;
}

interface SnapshotManifest {
  schemaVersion: 1;
  id: string;
  projectId: string;
  projectName: string;
  sourceRoot: string;
  createdAt: string;
  kind: BackupSnapshot["kind"];
  files: SnapshotFile[];
}

interface SnapshotVerificationRecord {
  schemaVersion: 1;
  manifestSha256: string;
  verifiedAt: string;
}

interface BackupSourceFile {
  sourcePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
}

const MANIFEST_NAME = ".latex-backup.json";
const VERIFICATION_NAME = ".latex-backup-verified.json";
const SETTINGS_NAME = "settings.json";
const EXCLUDED_DIRECTORY_PREFIXES = [
  ".git",
  ".latex-workbench/build",
  ".latex-workbench/local-research-recovered",
  ".latex-workbench/runtime",
  ".latex-workbench/undo",
  ".latex-workbench/snapshots",
  ".latex-workbench/trash"
];
const GENERATED_SUFFIXES = [
  ".aux", ".log", ".fls", ".fdb_latexmk", ".synctex.gz", ".toc", ".out", ".idx", ".ind", ".ilg"
];

function portablePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !/^[a-zA-Z]:|^[\\/]/.test(relation));
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 100) || "project";
}

function shouldExclude(relativePath: string): boolean {
  const normalized = portablePath(relativePath).toLocaleLowerCase("en-US");
  if (EXCLUDED_DIRECTORY_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) return true;
  return GENERATED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const backup = `${path}.${randomUUID()}.bak`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    if (existsSync(path)) await rename(path, backup);
    await rename(temporary, path);
    if (existsSync(backup)) await rm(backup, { force: true });
  } catch (error) {
    if (!existsSync(path) && existsSync(backup)) await rename(backup, path).catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function copyFileSynced(source: string, destination: string): Promise<void> {
  await copyFile(source, destination);
  const handle = await open(destination, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function backupCancelled(): Error {
  const error = new Error("项目备份已取消");
  error.name = "AbortError";
  return error;
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw backupCancelled();
}

async function copyStableSource(source: BackupSourceFile, destination: string, signal?: AbortSignal): Promise<string> {
  assertNotCancelled(signal);
  const before = await stat(source.sourcePath);
  if (!before.isFile() || before.size !== source.size || before.mtimeMs !== source.mtimeMs) {
    throw new Error(`备份源文件已被外部修改，请重新创建快照：${source.relativePath}`);
  }
  const beforeHash = await hashFile(source.sourcePath);
  assertNotCancelled(signal);
  await copyFileSynced(source.sourcePath, destination);
  assertNotCancelled(signal);
  const [after, afterHash, copiedHash] = await Promise.all([
    stat(source.sourcePath),
    hashFile(source.sourcePath),
    hashFile(destination)
  ]);
  if (!after.isFile() || after.size !== before.size || after.mtimeMs !== before.mtimeMs
    || afterHash !== beforeHash || copiedHash !== beforeHash) {
    throw new Error(`备份期间源文件发生变化，未生成不一致的快照：${source.relativePath}`);
  }
  return copiedHash;
}

async function collectProjectFiles(root: string): Promise<{ files: BackupSourceFile[]; excluded: string[] }> {
  const canonicalRoot = await realpath(root);
  const files: BackupSourceFile[] = [];
  const excluded: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = portablePath(relative(canonicalRoot, absolute));
      if (shouldExclude(relativePath)) {
        if (excluded.length < 100) excluded.push(relativePath);
        continue;
      }
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) {
        if (excluded.length < 100) excluded.push(`${relativePath}（符号链接）`);
        continue;
      }
      if (details.isDirectory()) {
        const canonical = await realpath(absolute);
        if (!isInside(canonicalRoot, canonical)) throw new Error(`Backup path escapes the project: ${relativePath}`);
        await visit(canonical);
      } else if (details.isFile()) {
        files.push({ sourcePath: absolute, relativePath, size: details.size, mtimeMs: details.mtimeMs });
      }
    }
  };
  await visit(canonicalRoot);
  return { files, excluded };
}

function parseManifest(value: unknown): SnapshotManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份清单格式无效");
  const manifest = value as Partial<SnapshotManifest>;
  if (manifest.schemaVersion !== 1 || typeof manifest.id !== "string" || typeof manifest.projectId !== "string" ||
      typeof manifest.projectName !== "string" || typeof manifest.createdAt !== "string" || !Array.isArray(manifest.files)) {
    throw new Error("备份清单缺少必要字段");
  }
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !file.path || file.path.includes("..") || file.path.startsWith("/") ||
        typeof file.size !== "number" || file.size < 0 || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      throw new Error("备份清单包含不安全的文件记录");
    }
  }
  return manifest as SnapshotManifest;
}

function parseVerificationRecord(value: unknown): SnapshotVerificationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<SnapshotVerificationRecord>;
  if (record.schemaVersion !== 1 || typeof record.verifiedAt !== "string" ||
      typeof record.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(record.manifestSha256)) return null;
  return record as SnapshotVerificationRecord;
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class ProjectBackupService {
  private readonly activeTasks = new Set<Promise<unknown>>();
  private readonly activeControllers = new Set<AbortController>();
  private readonly activeProjects = new Set<string>();
  private disposed = false;

  constructor(private readonly baseDirectory: string) {}

  async preview(project: ProjectSummary, research: CatalogProjectResearchItem[]): Promise<ProjectBackupPreview> {
    const collected = await collectProjectFiles(project.rootPath);
    const localPaths = new Set(research.flatMap((entry) => Object.values(entry.localAttachmentPaths)));
    let totalBytes = collected.files.reduce((sum, file) => sum + file.size, 0);
    let localOnlyAttachmentCount = 0;
    for (const path of localPaths) {
      const details = await stat(path).catch(() => null);
      if (details?.isFile()) {
        totalBytes += details.size;
        localOnlyAttachmentCount += 1;
      }
    }
    return {
      projectId: project.id,
      fileCount: collected.files.length + localOnlyAttachmentCount,
      totalBytes,
      localOnlyAttachmentCount,
      excludedPaths: collected.excluded
    };
  }

  async create(
    project: ProjectSummary,
    research: CatalogProjectResearchItem[],
    kind: BackupSnapshot["kind"] = "manual",
    signal?: AbortSignal
  ): Promise<BackupSnapshot> {
    if (this.disposed) throw new Error("备份服务正在关闭，不能开始新的快照");
    if (this.activeProjects.has(project.id)) throw new Error("该项目已有备份任务正在运行");
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    this.activeProjects.add(project.id);
    this.activeControllers.add(controller);
    const task = this.performCreate(project, research, kind, controller.signal);
    this.activeTasks.add(task);
    try {
      return await task;
    } finally {
      this.activeTasks.delete(task);
      this.activeControllers.delete(controller);
      this.activeProjects.delete(project.id);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async performCreate(
    project: ProjectSummary,
    research: CatalogProjectResearchItem[],
    kind: BackupSnapshot["kind"],
    signal: AbortSignal
  ): Promise<BackupSnapshot> {
    await this.cleanupTemporaryArtifacts(project.id);
    assertNotCancelled(signal);
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const projectDirectory = join(this.baseDirectory, safeSegment(project.id));
    const destination = join(projectDirectory, id);
    const temporary = `${destination}.tmp`;
    await mkdir(projectDirectory, { recursive: true });
    if (existsSync(destination) || existsSync(temporary)) throw new Error("备份目标已经存在");
    const manifest: SnapshotManifest = {
      schemaVersion: 1,
      id,
      projectId: project.id,
      projectName: project.name,
      sourceRoot: project.rootPath,
      createdAt: new Date().toISOString(),
      kind,
      files: []
    };
    try {
      const collected = await collectProjectFiles(project.rootPath);
      for (const source of collected.files) {
        assertNotCancelled(signal);
        const outputPath = portablePath(join("project", source.relativePath));
        const output = join(temporary, ...outputPath.split("/"));
        await mkdir(dirname(output), { recursive: true });
        const copiedHash = await copyStableSource(source, output, signal);
        manifest.files.push({ path: outputPath, size: source.size, sha256: copiedHash, source: "project" });
      }
      const seenLocalPaths = new Set<string>();
      for (const entry of research) {
        for (const [attachmentId, sourcePath] of Object.entries(entry.localAttachmentPaths)) {
          assertNotCancelled(signal);
          const canonical = await realpath(sourcePath).catch(() => null);
          if (!canonical || seenLocalPaths.has(canonical)) continue;
          const details = await stat(canonical).catch(() => null);
          if (!details?.isFile()) continue;
          seenLocalPaths.add(canonical);
          const outputPath = portablePath(join("local-research", safeSegment(attachmentId), basename(canonical)));
          const output = join(temporary, ...outputPath.split("/"));
          await mkdir(dirname(output), { recursive: true });
          const copiedHash = await copyStableSource({
            sourcePath: canonical,
            relativePath: `仅本机资料/${basename(canonical)}`,
            size: details.size,
            mtimeMs: details.mtimeMs
          }, output, signal);
          manifest.files.push({ path: outputPath, size: details.size, sha256: copiedHash, source: "localResearch", attachmentId });
        }
      }
      assertNotCancelled(signal);
      await writeJsonAtomic(join(temporary, MANIFEST_NAME), manifest);
      assertNotCancelled(signal);
      await rename(temporary, destination);
      const verification = await this.verify(project.id, id);
      if (!verification.valid) throw new Error(`备份校验失败：${verification.errors.join("；")}`);
      await this.prune(project.id, (await this.settings(project.id)).retainCount);
      return this.snapshotFromManifest(destination, manifest, true);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      if (existsSync(destination)) await rm(destination, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async list(projectId: string): Promise<BackupSnapshot[]> {
    if (!this.activeProjects.has(projectId)) await this.cleanupTemporaryArtifacts(projectId);
    const directory = join(this.baseDirectory, safeSegment(projectId));
    if (!existsSync(directory)) return [];
    const snapshots: BackupSnapshot[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.endsWith(".tmp")) continue;
      const path = join(directory, entry.name);
      const frozen = await this.readFrozenManifest(path).catch(() => null);
      if (!frozen || frozen.manifest.projectId !== projectId) continue;
      const verification = await this.readVerificationRecord(path).catch(() => null);
      const verified = verification?.manifestSha256 === frozen.manifestSha256;
      snapshots.push(this.snapshotFromManifest(path, frozen.manifest, verified, verified ? verification.verifiedAt : undefined));
    }
    return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async verify(projectId: string, snapshotId: string): Promise<BackupVerification> {
    const directory = this.snapshotDirectory(projectId, snapshotId);
    const frozen = await this.readFrozenManifest(directory);
    const result = await this.verifyFrozenManifest(directory, frozen.manifest, projectId, snapshotId);
    if (result.valid) {
      await writeJsonAtomic(join(directory, VERIFICATION_NAME), {
        schemaVersion: 1,
        manifestSha256: frozen.manifestSha256,
        verifiedAt: new Date().toISOString()
      } satisfies SnapshotVerificationRecord);
    }
    return result;
  }

  async restore(
    projectId: string,
    snapshotId: string,
    destinationPath: string,
    signal?: AbortSignal
  ): Promise<BackupRestoreResult> {
    if (this.disposed) throw new Error("备份服务正在关闭，不能开始新的恢复任务。");
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    this.activeControllers.add(controller);
    const task = this.performRestore(projectId, snapshotId, destinationPath, controller.signal);
    this.activeTasks.add(task);
    try {
      return await task;
    } finally {
      this.activeTasks.delete(task);
      this.activeControllers.delete(controller);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async performRestore(
    projectId: string,
    snapshotId: string,
    destinationPath: string,
    signal: AbortSignal
  ): Promise<BackupRestoreResult> {
    assertNotCancelled(signal);
    const destination = resolve(destinationPath);
    if (existsSync(destination)) throw new Error("恢复目标必须是尚不存在的新目录");
    const source = this.snapshotDirectory(projectId, snapshotId);
    // Freeze one exact manifest for the entire restore. A later mutation of the
    // snapshot can no longer swap in a different list after validation.
    const frozen = await this.readFrozenManifest(source);
    assertNotCancelled(signal);
    const manifest = frozen.manifest;
    const verification = await this.verifyFrozenManifest(source, manifest, projectId, snapshotId);
    if (!verification.valid) throw new Error(`备份校验失败：${verification.errors.join("；")}`);
    const temporary = `${destination}.restore-${randomUUID()}.tmp`;
    try {
      await mkdir(temporary, { recursive: true });
      const projectFiles = manifest.files.filter((entry) => entry.source === "project");
      const localResearchFiles = manifest.files.filter((entry) => entry.source === "localResearch");
      for (const file of projectFiles) {
        assertNotCancelled(signal);
        const relativePath = file.path.replace(/^project\//, "");
        const input = join(source, ...file.path.split("/"));
        const output = join(temporary, ...relativePath.split("/"));
        await mkdir(dirname(output), { recursive: true });
        await copyFileSynced(input, output);
        await this.assertRestoredFile(output, file);
      }
      const recoveredResearchDirectory = join(temporary, ".latex-workbench", "local-research-recovered");
      const recoveredResearch: Array<{ attachmentId: string; relativePath: string; sha256: string; size: number }> = [];
      for (const file of localResearchFiles) {
        assertNotCancelled(signal);
        const attachmentId = safeSegment(file.attachmentId ?? "attachment");
        const input = join(source, ...file.path.split("/"));
        const relativePath = portablePath(join(".latex-workbench", "local-research-recovered", attachmentId, basename(file.path)));
        const output = join(temporary, ...relativePath.split("/"));
        await mkdir(dirname(output), { recursive: true });
        await copyFileSynced(input, output);
        await this.assertRestoredFile(output, file);
        recoveredResearch.push({ attachmentId, relativePath, sha256: file.sha256, size: file.size });
      }
      if (recoveredResearch.length > 0) {
        await writeJsonAtomic(join(recoveredResearchDirectory, "restore-map.json"), {
          schemaVersion: 1,
          projectId: manifest.projectId,
          snapshotId,
          restoredAt: new Date().toISOString(),
          attachments: recoveredResearch
        });
      }
      // Recheck every restored payload after all writes and before the atomic
      // directory rename. A changed snapshot or partial copy can never be
      // reported as a successful recovery.
      for (const file of projectFiles) {
        assertNotCancelled(signal);
        const relativePath = file.path.replace(/^project\//, "");
        await this.assertRestoredFile(join(temporary, ...relativePath.split("/")), file);
      }
      for (const file of localResearchFiles) {
        assertNotCancelled(signal);
        const attachmentId = safeSegment(file.attachmentId ?? "attachment");
        const relativePath = portablePath(join(".latex-workbench", "local-research-recovered", attachmentId, basename(file.path)));
        await this.assertRestoredFile(join(temporary, ...relativePath.split("/")), file);
      }
      assertNotCancelled(signal);
      await rename(temporary, destination);
      return {
        snapshotId,
        destinationPath: destination,
        restoredFiles: projectFiles.length,
        restoredLocalAttachments: localResearchFiles.length,
        researchRecoveryPath: localResearchFiles.length > 0
          ? join(destination, ".latex-workbench", "local-research-recovered")
          : undefined
      };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async settings(projectId: string): Promise<ProjectBackupSettings> {
    const all = await this.readSettings();
    return all[projectId] ?? {
      projectId,
      frequency: "off",
      retainCount: 7,
      updatedAt: new Date(0).toISOString()
    };
  }

  async setSettings(projectId: string, value: Pick<ProjectBackupSettings, "frequency" | "retainCount">): Promise<ProjectBackupSettings> {
    if (!["off", "daily", "weekly"].includes(value.frequency)) throw new Error("不支持的备份频率");
    const retainCount = Math.max(1, Math.min(30, Math.trunc(value.retainCount)));
    const all = await this.readSettings();
    const settings: ProjectBackupSettings = { projectId, frequency: value.frequency, retainCount, updatedAt: new Date().toISOString() };
    all[projectId] = settings;
    await writeJsonAtomic(join(this.baseDirectory, SETTINGS_NAME), all);
    // Retention is applied only after a newly-created snapshot has been fully
    // copied and verified. Merely changing a preference must not immediately
    // destroy existing recovery points.
    return settings;
  }

  async runDue(
    project: ProjectSummary,
    research: CatalogProjectResearchItem[],
    signal?: AbortSignal
  ): Promise<BackupSnapshot | null> {
    assertNotCancelled(signal);
    const settings = await this.settings(project.id);
    if (settings.frequency === "off") return null;
    const latest = (await this.list(project.id))[0];
    const interval = settings.frequency === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    if (latest && Date.now() - Date.parse(latest.createdAt) < interval) return null;
    return this.create(project, research, "scheduled", signal);
  }

  async cleanupTemporaryArtifacts(projectId?: string): Promise<number> {
    if (!existsSync(this.baseDirectory)) return 0;
    const projectDirectories = projectId
      ? [join(this.baseDirectory, safeSegment(projectId))]
      : (await readdir(this.baseDirectory, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(this.baseDirectory, entry.name));
    let removed = 0;
    for (const directory of projectDirectories) {
      if (!existsSync(directory)) continue;
      const active = projectId
        ? this.activeProjects.has(projectId)
        : [...this.activeProjects].some((id) => safeSegment(id) === basename(directory));
      if (active) continue;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith(".tmp")) continue;
        await rm(join(directory, entry.name), { recursive: true, force: true });
        removed += 1;
      }
    }
    return removed;
  }

  async dispose(timeoutMs = 5_000): Promise<{ timedOut: boolean; removedTemporaryDirectories: number }> {
    this.disposed = true;
    for (const controller of this.activeControllers) controller.abort();
    let timedOut = false;
    if (this.activeTasks.size > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...this.activeTasks]),
        new Promise<void>((resolveTimeout) => {
          timer = setTimeout(() => { timedOut = true; resolveTimeout(); }, Math.max(1, timeoutMs));
          timer.unref();
        })
      ]);
      if (timer) clearTimeout(timer);
    }
    const removedTemporaryDirectories = timedOut ? 0 : await this.cleanupTemporaryArtifacts();
    return { timedOut, removedTemporaryDirectories };
  }

  private snapshotDirectory(projectId: string, snapshotId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(snapshotId)) throw new Error("备份 ID 无效");
    const projectDirectory = join(this.baseDirectory, safeSegment(projectId));
    const snapshot = resolve(projectDirectory, snapshotId);
    if (!isInside(projectDirectory, snapshot)) throw new Error("备份路径越界");
    return snapshot;
  }

  private async readManifest(directory: string): Promise<SnapshotManifest> {
    return parseManifest(JSON.parse(await readFile(join(directory, MANIFEST_NAME), "utf8")) as unknown);
  }

  private async readFrozenManifest(directory: string): Promise<{ manifest: SnapshotManifest; manifestSha256: string }> {
    const raw = await readFile(join(directory, MANIFEST_NAME), "utf8");
    return { manifest: parseManifest(JSON.parse(raw) as unknown), manifestSha256: hashText(raw) };
  }

  private async readVerificationRecord(directory: string): Promise<SnapshotVerificationRecord | null> {
    const path = join(directory, VERIFICATION_NAME);
    if (!existsSync(path)) return null;
    return parseVerificationRecord(JSON.parse(await readFile(path, "utf8")) as unknown);
  }

  private async verifyFrozenManifest(
    directory: string,
    manifest: SnapshotManifest,
    expectedProjectId: string,
    expectedSnapshotId: string
  ): Promise<BackupVerification> {
    const errors: string[] = [];
    let checkedFiles = 0;
    if (manifest.projectId !== expectedProjectId || manifest.id !== expectedSnapshotId) errors.push("备份身份不匹配");
    for (const file of manifest.files) {
      const candidate = resolve(directory, ...file.path.split("/"));
      if (!isInside(directory, candidate)) {
        errors.push(`${file.path} 路径越界`);
        continue;
      }
      const details = await stat(candidate).catch(() => null);
      if (!details?.isFile()) {
        errors.push(`${file.path} 已丢失`);
        continue;
      }
      if (details.size !== file.size) {
        errors.push(`${file.path} 大小不一致`);
        continue;
      }
      checkedFiles += 1;
      if (await hashFile(candidate) !== file.sha256) errors.push(`${file.path} 内容校验失败`);
    }
    return { snapshotId: expectedSnapshotId, valid: errors.length === 0, checkedFiles, errors: errors.slice(0, 100) };
  }

  private async assertRestoredFile(path: string, expected: SnapshotFile): Promise<void> {
    const details = await stat(path).catch(() => null);
    if (!details?.isFile() || details.size !== expected.size || await hashFile(path) !== expected.sha256) {
      throw new Error(`恢复文件校验失败：${expected.path}`);
    }
  }

  private snapshotFromManifest(path: string, manifest: SnapshotManifest, verified: boolean, verifiedAt?: string): BackupSnapshot {
    return {
      id: manifest.id,
      projectId: manifest.projectId,
      projectName: manifest.projectName,
      path,
      createdAt: manifest.createdAt,
      size: manifest.files.reduce((sum, file) => sum + file.size, 0),
      fileCount: manifest.files.length,
      kind: manifest.kind,
      verified,
      verifiedAt
    };
  }

  private async readSettings(): Promise<Record<string, ProjectBackupSettings>> {
    const path = join(this.baseDirectory, SETTINGS_NAME);
    if (!existsSync(path)) return {};
    return JSON.parse(await readFile(path, "utf8")) as Record<string, ProjectBackupSettings>;
  }

  private async prune(projectId: string, retainCount: number): Promise<void> {
    const snapshots = await this.list(projectId);
    for (const snapshot of snapshots.slice(Math.max(1, retainCount))) {
      const directory = this.snapshotDirectory(projectId, snapshot.id);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
