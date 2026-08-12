import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
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
  for (const item of index.researchItems ?? []) {
    for (const link of item.links) {
      if (link.targetId && !targets.has(link.targetId)) {
        throw new Error(`Research material ${item.title || item.id} references an unknown document target: ${link.targetId}`);
      }
    }
  }
}

async function gitBlobSha(path: string): Promise<string> {
  const details = await stat(path);
  const hash = createHash("sha1").update(`blob ${details.size}\0`, "utf8");
  await updateHashFromFile(hash, path);
  return hash.digest("hex");
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await updateHashFromFile(hash, path);
  return hash.digest("hex");
}

async function updateHashFromFile(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
}

function assertResearchPathAllowed(path: string): void {
  const first = path.split("/", 1)[0]?.toLocaleLowerCase("en-US");
  if (first === ".git" || first === ".latex-workbench") {
    throw new Error(`Research attachments cannot use an internal project path: ${path}`);
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
    const verifiedOutputs: MobileProjectIndex["outputs"] = [];
    for (const output of parsed.outputs) {
      const absolute = resolve(root, ...output.pdfPath.split("/"));
      const portable = portableRelativePath(root, absolute);
      if (portable !== output.pdfPath) throw new Error(`PDF 路径必须使用规范的项目相对路径：${output.pdfPath}`);
      const metadata = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") throw new Error(`找不到主 PDF：${output.pdfPath}`);
        throw error;
      });
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`主 PDF 必须是普通文件：${output.pdfPath}`);
      const generatedAt = metadata.mtime.toISOString();
      verifiedOutputs.push({
        ...output,
        pdfPath: portable,
        blobSha: await gitBlobSha(absolute),
        size: metadata.size,
        generatedAt
      });
    }

    const verifiedResearchItems: MobileProjectIndex["researchItems"] = [];
    for (const item of parsed.researchItems ?? []) {
      const attachments = [];
      for (const attachment of item.attachments) {
        if (attachment.availability === "localOnly") {
          attachments.push({
            id: attachment.id,
            name: attachment.name,
            mediaType: attachment.mediaType,
            versionLabel: attachment.versionLabel,
            availability: "localOnly" as const
          });
          continue;
        }
        const relativePath = attachment.relativePath!;
        assertResearchPathAllowed(relativePath);
        const absolute = resolve(root, ...relativePath.split("/"));
        const portable = portableRelativePath(root, absolute);
        if (portable !== relativePath) throw new Error(`Research attachment paths must be canonical project-relative paths: ${relativePath}`);
        const metadata = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") throw new Error(`Research attachment is missing: ${relativePath}`);
          throw error;
        });
        if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Research attachments must be regular files: ${relativePath}`);
        attachments.push({
          ...attachment,
          relativePath: portable,
          size: metadata.size,
          sha256: await sha256(absolute),
          gitBlobSha: await gitBlobSha(absolute),
          availability: "repository" as const
        });
      }
      verifiedResearchItems.push({ ...item, attachments });
    }

    const normalized: MobileProjectIndex = {
      ...parsed,
      schemaVersion: parsed.schemaVersion === 3 ? 3 : 2,
      name: parsed.name.trim(),
      updatedAt: new Date().toISOString(),
      outputs: verifiedOutputs,
      ...(parsed.schemaVersion === 3 ? { researchItems: verifiedResearchItems } : {})
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
