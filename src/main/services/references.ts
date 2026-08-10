import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ReferenceDocumentInfo, ReferenceDocumentKind } from "../../shared/types";
import { hashFile } from "./files";

export const REFERENCES_DIRECTORY = "references";
const LFS_RECOMMENDED_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".epub", ".djvu", ".mobi", ".azw3",
  ".doc", ".docx", ".odt", ".rtf", ".txt", ".md", ".html", ".htm",
  ".tex", ".bib", ".zip"
]);

export interface ReferenceServiceOptions {
  openPath?: (path: string) => Promise<string>;
  trashItem?: (path: string) => Promise<void>;
}

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function kindFor(path: string): ReferenceDocumentKind {
  const extension = extname(path).toLocaleLowerCase("en-US");
  if (extension === ".pdf") return "pdf";
  if (new Set([".epub", ".djvu", ".mobi", ".azw3"]).has(extension)) return "ebook";
  if (new Set([".doc", ".docx", ".odt", ".rtf", ".txt", ".md", ".html", ".htm", ".tex", ".bib"]).has(extension)) return "document";
  if (extension === ".zip") return "archive";
  return "other";
}

function assertAllowedDocument(path: string): void {
  if (!ALLOWED_EXTENSIONS.has(extname(path).toLocaleLowerCase("en-US"))) {
    throw new Error(`不支持的原始文稿格式：${extname(path) || "无扩展名"}`);
  }
}

async function availableDestination(directory: string, sourceName: string): Promise<string> {
  const extension = extname(sourceName);
  const stem = basename(sourceName, extension);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const name = suffix === 1 ? sourceName : `${stem} (${suffix})${extension}`;
    const candidate = join(directory, name);
    try {
      await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error(`无法为 ${sourceName} 创建不冲突的文件名。`);
}

export class ReferenceService {
  private readonly openPath: (path: string) => Promise<string>;
  private readonly trashItem: (path: string) => Promise<void>;

  constructor(options: ReferenceServiceOptions = {}) {
    this.openPath = options.openPath ?? (async () => "");
    this.trashItem = options.trashItem ?? (async (path) => { await rm(path, { force: true }); });
  }

  directory(root: string): string {
    return join(resolve(root), REFERENCES_DIRECTORY);
  }

  async list(root: string): Promise<ReferenceDocumentInfo[]> {
    const directory = this.directory(root);
    try {
      await mkdir(directory, { recursive: true });
      return (await this.collect(root, directory)).sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.name.localeCompare(right.name, "zh-CN"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async importFiles(root: string, sourcePaths: string[]): Promise<ReferenceDocumentInfo[]> {
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) return this.list(root);
    const directory = this.directory(root);
    await mkdir(directory, { recursive: true });
    const canonicalDirectory = await realpath(directory);
    for (const sourcePath of sourcePaths) {
      if (typeof sourcePath !== "string" || !sourcePath) throw new Error("原始文稿路径无效。");
      assertAllowedDocument(sourcePath);
      const metadata = await lstat(sourcePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`只能导入普通文稿文件：${sourcePath}`);
      const canonicalSource = await realpath(sourcePath);
      if (isInside(canonicalDirectory, canonicalSource)) continue;
      const destination = await availableDestination(directory, basename(sourcePath));
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
      try {
        const [sourceHash, destinationHash] = await Promise.all([hashFile(sourcePath), hashFile(destination)]);
        if (sourceHash !== destinationHash) throw new Error(`复制校验失败：${basename(sourcePath)}`);
      } catch (error) {
        await rm(destination, { force: true });
        throw error;
      }
    }
    return this.list(root);
  }

  async open(root: string, relativePath: string): Promise<void> {
    const path = await this.resolveDocument(root, relativePath);
    const error = await this.openPath(path);
    if (error) throw new Error(error);
  }

  async openFolder(root: string): Promise<void> {
    const directory = this.directory(root);
    await mkdir(directory, { recursive: true });
    const error = await this.openPath(directory);
    if (error) throw new Error(error);
  }

  async remove(root: string, relativePath: string): Promise<ReferenceDocumentInfo[]> {
    const path = await this.resolveDocument(root, relativePath);
    await this.trashItem(path);
    return this.list(root);
  }

  private async resolveDocument(root: string, relativePath: string): Promise<string> {
    if (typeof relativePath !== "string" || !relativePath || isAbsolute(relativePath)) throw new Error("原始文稿路径无效。");
    const directory = this.directory(root);
    const candidate = resolve(root, relativePath);
    if (!isInside(directory, candidate) || candidate === directory) throw new Error("原始文稿路径越出了 references 文件夹。");
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("只能操作普通文稿文件。");
    const [canonicalDirectory, canonicalCandidate] = await Promise.all([realpath(directory), realpath(candidate)]);
    if (!isInside(canonicalDirectory, canonicalCandidate)) throw new Error("原始文稿路径包含不安全的链接。");
    assertAllowedDocument(candidate);
    return canonicalCandidate;
  }

  private async collect(root: string, directory: string): Promise<ReferenceDocumentInfo[]> {
    const result: ReferenceDocumentInfo[] = [];
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error(`references 文件夹包含不安全的符号链接：${entry.name}`);
      if (metadata.isDirectory()) {
        result.push(...await this.collect(root, path));
        continue;
      }
      if (!metadata.isFile() || !ALLOWED_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("en-US"))) continue;
      const details = await stat(path);
      result.push({
        name: entry.name,
        relativePath: portablePath(relative(root, path)),
        size: details.size,
        modifiedAt: details.mtime.toISOString(),
        kind: kindFor(path),
        lfsRecommended: details.size >= LFS_RECOMMENDED_SIZE
      });
    }
    return result;
  }
}
