import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { GitHubChangedFile, GitHubLargeFile, SyncSecurityFinding } from "../../shared/types";

const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;
const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519"
]);

const SECRET_PATTERNS: Array<{ label: string; expression: RegExp }> = [
  { label: "私钥", expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { label: "GitHub 访问令牌", expression: /\b(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})\b/ },
  { label: "AWS 访问密钥", expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "常见 API 密钥", expression: /\bsk-[A-Za-z0-9_-]{32,}\b/ }
];

export async function scanSyncSecurity(
  root: string,
  changes: GitHubChangedFile[],
  largeFiles: GitHubLargeFile[]
): Promise<SyncSecurityFinding[]> {
  const findings: SyncSecurityFinding[] = [];
  const largeByPath = new Map(largeFiles.map((file) => [file.path, file]));

  for (const change of changes) {
    if (change.status.includes("D")) continue;
    const name = basename(change.path).toLocaleLowerCase("en-US");
    if (SENSITIVE_FILE_NAMES.has(name) || name.endsWith(".pem") || name.endsWith(".p12") || name.endsWith(".pfx")) {
      findings.push({
        path: change.path,
        kind: "sensitiveFile",
        severity: "warning",
        message: "文件名可能包含凭据或私密配置，请确认是否应上传。"
      });
    }

    const large = largeByPath.get(change.path);
    if (large && !large.trackedByLfs) {
      findings.push({
        path: change.path,
        kind: "largeFile",
        severity: large.size > 100 * 1024 * 1024 ? "block" : "warning",
        message: large.size > 100 * 1024 * 1024
          ? "文件超过 GitHub 普通文件限制，必须先使用 Git LFS。"
          : "大文件尚未由 Git LFS 跟踪，可能导致同步缓慢或失败。"
      });
    }

    const absolute = resolve(root, ...change.path.split("/"));
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_TEXT_SCAN_BYTES) continue;
    const bytes = await readFile(absolute);
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    for (const pattern of SECRET_PATTERNS) {
      if (!pattern.expression.test(content)) continue;
      findings.push({
        path: change.path,
        kind: "secret",
        severity: "block",
        message: `检测到疑似${pattern.label}，为防止泄露已暂停同步。`
      });
      break;
    }
  }

  return findings.sort((left, right) => left.severity === right.severity
    ? left.path.localeCompare(right.path)
    : left.severity === "block" ? -1 : 1);
}

