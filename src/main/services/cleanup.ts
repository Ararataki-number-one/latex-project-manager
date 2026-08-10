import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { TemporaryCleanupPreview, TemporaryCleanupResult } from "../../shared/types";

const PLAN_LIFETIME_MS = 5 * 60 * 1000;
const MAX_SCANNED_ENTRIES = 200_000;
const MAX_SCAN_DEPTH = 64;

const TEMPORARY_SUFFIXES = [
  ".aux",
  ".auxlock",
  ".bcf",
  ".blg",
  ".dvi",
  ".fdb_latexmk",
  ".fls",
  ".glg",
  ".glo",
  ".gls",
  ".idx",
  ".ilg",
  ".ind",
  ".lof",
  ".log",
  ".lot",
  ".nav",
  ".out",
  ".run.xml",
  ".snm",
  ".synctex.gz",
  ".toc",
  ".vrb",
  ".xdv"
] as const;

const OWNED_CACHE_ROOTS = [".latex-workbench/build", ".latex-workbench/runtime"] as const;
const SKIPPED_DIRECTORY_ROOTS = [
  ".git",
  "node_modules",
  "references",
  ".latex-workbench/snapshots",
  ".latex-workbench/trash"
] as const;

interface CleanupFile {
  relativePath: string;
  size: number;
  mtimeMs: number;
  category: "LaTeX 辅助文件" | "工作台构建缓存";
}

interface CleanupPlan {
  projectId: string;
  root: string;
  files: CleanupFile[];
  directories: string[];
  expiresAt: number;
}

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function foldedPath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function atOrBelow(path: string, roots: readonly string[]): boolean {
  const normalized = portablePath(path).toLocaleLowerCase("en-US");
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function isTemporaryFile(name: string): boolean {
  const normalized = name.toLocaleLowerCase("en-US");
  return TEMPORARY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export class TemporaryCleanupService {
  private readonly plans = new Map<string, CleanupPlan>();

  async preview(projectId: string, projectRoot: string): Promise<TemporaryCleanupPreview> {
    const root = await realpath(resolve(projectRoot));
    const rootMetadata = await lstat(root);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw new Error("项目根目录不可用于临时文件扫描。");
    this.removeExpiredPlans();

    const files: CleanupFile[] = [];
    const directories: string[] = [];
    let scannedEntries = 0;

    const scan = async (current = "", depth = 0, insideOwnedCache = false): Promise<void> => {
      if (depth > MAX_SCAN_DEPTH) throw new Error("项目目录层级过深，已停止临时文件扫描。");
      const entries = await readdir(join(root, current), { withFileTypes: true });
      for (const entry of entries) {
        scannedEntries += 1;
        if (scannedEntries > MAX_SCANNED_ENTRIES) throw new Error("项目文件过多，已停止临时文件扫描。");
        const relativePath = current ? join(current, entry.name) : entry.name;
        const portable = portablePath(relativePath);
        const absolutePath = join(root, relativePath);
        const metadata = await lstat(absolutePath);
        if (metadata.isSymbolicLink()) continue;

        if (metadata.isDirectory()) {
          if (atOrBelow(portable, SKIPPED_DIRECTORY_ROOTS)) continue;
          const owned = insideOwnedCache || atOrBelow(portable, OWNED_CACHE_ROOTS);
          await scan(relativePath, depth + 1, owned);
          if (owned) directories.push(portable);
          continue;
        }
        if (!metadata.isFile()) continue;

        const owned = insideOwnedCache || atOrBelow(portable, OWNED_CACHE_ROOTS);
        const protectedPdf = entry.name.toLocaleLowerCase("en-US").endsWith(".pdf");
        if ((!owned && !isTemporaryFile(entry.name)) || protectedPdf) continue;
        files.push({
          relativePath: portable,
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
          category: owned ? "工作台构建缓存" : "LaTeX 辅助文件"
        });
      }
    };

    await scan();
    directories.sort((left, right) => right.split("/").length - left.split("/").length);
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
    const categories = [...new Set(files.map((file) => file.category))].map((name) => ({
      name,
      count: files.filter((file) => file.category === name).length
    }));
    const planId = randomUUID();
    const expiresAt = Date.now() + PLAN_LIFETIME_MS;
    this.plans.set(planId, { projectId, root, files, directories, expiresAt });
    return {
      planId,
      fileCount: files.length,
      directoryCount: directories.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      samplePaths: files.slice(0, 12).map((file) => file.relativePath),
      categories,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  async apply(projectId: string, projectRoot: string, planId: string): Promise<TemporaryCleanupResult> {
    const plan = this.plans.get(planId);
    if (!plan || plan.projectId !== projectId || plan.expiresAt < Date.now()) {
      this.plans.delete(planId);
      throw new Error("清理预览已过期，请重新扫描后再确认。");
    }
    const root = await realpath(resolve(projectRoot));
    if (foldedPath(root) !== foldedPath(plan.root)) throw new Error("项目路径已经变化，请重新扫描。");

    const existingFiles: Array<CleanupFile & { absolutePath: string }> = [];
    for (const file of plan.files) {
      const absolutePath = resolve(root, file.relativePath);
      if (!isInside(root, absolutePath)) throw new Error("清理计划包含项目目录之外的路径。");
      try {
        const metadata = await lstat(absolutePath);
        if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== file.size || Math.abs(metadata.mtimeMs - file.mtimeMs) > 1) {
          throw new Error(`文件在预览后发生变化：${file.relativePath}`);
        }
        existingFiles.push({ ...file, absolutePath });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }

    for (const file of existingFiles) await rm(file.absolutePath);
    let removedDirectories = 0;
    for (const relativePath of plan.directories) {
      const absolutePath = resolve(root, relativePath);
      if (!isInside(root, absolutePath) || absolutePath === root) continue;
      try {
        const metadata = await lstat(absolutePath);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) continue;
        await rmdir(absolutePath);
        removedDirectories += 1;
      } catch (error) {
        if (!new Set(["ENOENT", "ENOTEMPTY", "EEXIST"]).has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
    this.plans.delete(planId);
    return {
      fileCount: existingFiles.length,
      directoryCount: removedDirectories,
      freedBytes: existingFiles.reduce((total, file) => total + file.size, 0)
    };
  }

  private removeExpiredPlans(): void {
    const now = Date.now();
    for (const [planId, plan] of this.plans) if (plan.expiresAt < now) this.plans.delete(planId);
  }
}
