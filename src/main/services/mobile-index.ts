import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

import { parseMobileProjectIndex } from "../../shared/schema";
import type {
  MobilePdfCandidate,
  MobileProjectIndex,
  ProjectManifest,
  ProjectPdfInfo
} from "../../shared/types";

export const MOBILE_PROJECT_INDEX_FILE = ".latex-project.json";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".latex-workbench",
  "references",
  "node_modules",
  "dist",
  "dist-web"
]);

function portableRelativePath(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relation = relative(resolvedRoot, resolvedCandidate);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || /^[a-zA-Z]:|^[\\/]/.test(relation)) {
    throw new Error("移动端文件必须位于项目根目录内。");
  }
  return relation.split(sep).join("/");
}

function outputBaseName(entry: string): string {
  const name = basename(entry);
  const extension = extname(name);
  return (extension ? name.slice(0, -extension.length) : name).toLocaleLowerCase("en-US");
}

function validateAgainstManifest(index: MobileProjectIndex, manifest: ProjectManifest): void {
  if (index.projectId !== manifest.projectId) throw new Error("移动索引与项目清单的项目 ID 不一致。");
  const targets = new Map(manifest.targets.map((target) => [target.id, target]));
  for (const output of index.outputs) {
    const target = targets.get(output.targetId);
    if (!target) throw new Error(`移动输出引用了不存在的文档目标：${output.targetId}`);
    if (target.entry !== output.entry) throw new Error(`移动输出入口与文档目标不一致：${output.name}`);
    if (output.profileId && !target.profiles.some((profile) => profile.id === output.profileId)) {
      throw new Error(`移动输出引用了不存在的编译方案：${output.profileId}`);
    }
  }
}

export class MobileIndexService {
  async read(root: string): Promise<MobileProjectIndex | null> {
    try {
      const value = JSON.parse(await readFile(resolve(root, MOBILE_PROJECT_INDEX_FILE), "utf8")) as unknown;
      return parseMobileProjectIndex(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw new Error(".latex-project.json 不是有效的 JSON。", { cause: error });
      throw error;
    }
  }

  async write(root: string, manifest: ProjectManifest, value: MobileProjectIndex): Promise<MobileProjectIndex> {
    const parsed = parseMobileProjectIndex(value);
    validateAgainstManifest(parsed, manifest);
    for (const output of parsed.outputs) {
      const absolute = resolve(root, ...output.pdfPath.split("/"));
      const portable = portableRelativePath(root, absolute);
      if (portable !== output.pdfPath) throw new Error(`PDF 路径必须使用规范的项目相对路径：${output.pdfPath}`);
      const metadata = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") throw new Error(`找不到主 PDF：${output.pdfPath}`);
        throw error;
      });
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`主 PDF 必须是普通文件：${output.pdfPath}`);
    }

    const normalized: MobileProjectIndex = {
      ...parsed,
      name: parsed.name.trim(),
      updatedAt: new Date().toISOString(),
      outputs: parsed.outputs.map((output) => ({ ...output, pdfPath: output.pdfPath.split("\\").join("/") }))
    };
    const destination = resolve(root, MOBILE_PROJECT_INDEX_FILE);
    const temporary = resolve(dirname(destination), `${MOBILE_PROJECT_INDEX_FILE}.${randomBytes(5).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return normalized;
  }

  async candidates(root: string, manifest: ProjectManifest, latestPdf?: ProjectPdfInfo | null): Promise<MobilePdfCandidate[]> {
    const result: MobilePdfCandidate[] = [];
    let latestPath: string | undefined;
    if (latestPdf?.path && existsSync(latestPdf.path)) {
      try {
        latestPath = portableRelativePath(root, latestPdf.path);
      } catch {
        // Older build records may point outside the imported project. Such files
        // are never eligible mobile outputs and must not make candidate scanning fail.
      }
    }

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 10 || result.length >= 2_000) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (result.length >= 2_000) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase("en-US"))) await walk(absolute, depth + 1);
          continue;
        }
        if (!entry.isFile() || extname(entry.name).toLocaleLowerCase("en-US") !== ".pdf") continue;
        const metadata = await stat(absolute);
        const relativePath = portableRelativePath(root, absolute);
        const candidateBase = outputBaseName(relativePath);
        const suggestedTargetIds = manifest.targets
          .filter((target) => outputBaseName(target.entry) === candidateBase || relativePath === latestPath)
          .map((target) => target.id);
        result.push({ relativePath, size: metadata.size, modifiedAt: metadata.mtime.toISOString(), suggestedTargetIds });
      }
    };

    await walk(resolve(root), 0);
    return result.sort((left, right) => {
      const suggested = Number(right.suggestedTargetIds.length > 0) - Number(left.suggestedTargetIds.length > 0);
      return suggested || right.modifiedAt.localeCompare(left.modifiedAt) || left.relativePath.localeCompare(right.relativePath);
    });
  }
}
