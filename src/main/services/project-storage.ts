import { lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { ProjectStorageInfo } from "../../shared/types";

const MAX_SCANNED_ENTRIES = 300_000;
const MAX_SCAN_DEPTH = 64;
const EXCLUDED_ROOTS = new Set([
  ".git",
  ".latex-workbench/build",
  ".latex-workbench/runtime",
  ".latex-workbench/snapshots",
  ".latex-workbench/trash"
]);

function portablePath(value: string): string {
  return value.split(sep).join("/").toLocaleLowerCase("en-US");
}

function excluded(relativePath: string): boolean {
  const portable = portablePath(relativePath);
  for (const root of EXCLUDED_ROOTS) if (portable === root || portable.startsWith(`${root}/`)) return true;
  return false;
}

export class ProjectStorageService {
  async measure(projectRoot: string): Promise<ProjectStorageInfo> {
    const root = await realpath(resolve(projectRoot));
    const rootMetadata = await lstat(root);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw new Error("项目根目录不可用于容量统计。");
    let totalBytes = 0;
    let fileCount = 0;
    let scannedEntries = 0;

    const scan = async (current = "", depth = 0): Promise<void> => {
      if (depth > MAX_SCAN_DEPTH) throw new Error("项目目录层级过深，已停止容量统计。");
      for (const entry of await readdir(join(root, current), { withFileTypes: true })) {
        scannedEntries += 1;
        if (scannedEntries > MAX_SCANNED_ENTRIES) throw new Error("项目文件过多，已停止容量统计。");
        const relativePath = current ? join(current, entry.name) : entry.name;
        if (excluded(relativePath)) continue;
        const metadata = await lstat(join(root, relativePath));
        if (metadata.isSymbolicLink()) continue;
        if (metadata.isDirectory()) await scan(relativePath, depth + 1);
        else if (metadata.isFile()) {
          fileCount += 1;
          totalBytes += metadata.size;
        }
      }
    };

    await scan();
    return { totalBytes, fileCount, measuredAt: new Date().toISOString() };
  }
}
