import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { GitHubChangedFile, GitHubLargeFile, SyncSecurityFinding, SyncSecurityRecoveryAction } from "../../shared/types";

const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;
const RESEARCH_DOCUMENT_EXTENSIONS = new Set([
  ".pdf", ".epub", ".djvu", ".mobi", ".azw3", ".doc", ".docx", ".odt", ".rtf",
  ".txt", ".md", ".html", ".htm", ".tex", ".bib", ".zip"
]);
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

export type SyncSecurityContentLoader = (path: string) => Promise<Buffer | null>;

export interface ManagedRepositoryResearchAttachment {
  path: string;
  name: string;
  publicUploadApproved: boolean;
}

/**
 * Read the portable project index defensively. This intentionally does not rely
 * on the full schema parser: security checks must still work when newer clients
 * add fields that this version does not understand.
 */
export function managedRepositoryResearchAttachments(content: Buffer | string): ManagedRepositoryResearchAttachment[] {
  try {
    const value = JSON.parse(Buffer.isBuffer(content) ? content.toString("utf8") : content) as {
      schemaVersion?: unknown;
      researchItems?: unknown;
    };
    if (value.schemaVersion !== 3 || !Array.isArray(value.researchItems)) return [];
    const found = new Map<string, ManagedRepositoryResearchAttachment>();
    for (const item of value.researchItems) {
      if (!item || typeof item !== "object" || !Array.isArray((item as { attachments?: unknown }).attachments)) continue;
      for (const raw of (item as { attachments: unknown[] }).attachments) {
        if (!raw || typeof raw !== "object") continue;
        const attachment = raw as Record<string, unknown>;
        if (attachment.availability !== "repository" || typeof attachment.relativePath !== "string") continue;
        const path = attachment.relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
        if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.split("/").includes("..")) continue;
        found.set(path, {
          path,
          name: typeof attachment.name === "string" && attachment.name.trim() ? attachment.name.trim() : basename(path),
          publicUploadApproved: attachment.publicUploadApproved === true
        });
      }
    }
    return [...found.values()];
  } catch {
    return [];
  }
}

export function scanPublicResearchCopyright(
  projectIndexContent: Buffer | string | null,
  candidatePaths: Iterable<string>
): SyncSecurityFinding[] {
  const present = new Set([...candidatePaths].map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "")));
  const managed = new Map((projectIndexContent ? managedRepositoryResearchAttachments(projectIndexContent) : [])
    .map((attachment) => [attachment.path, attachment] as const));
  const candidates = new Set<string>();
  for (const path of present) {
    const normalized = path.toLocaleLowerCase("en-US");
    const extension = normalized.includes(".") ? normalized.slice(normalized.lastIndexOf(".")) : "";
    if (normalized.startsWith("references/") && RESEARCH_DOCUMENT_EXTENSIONS.has(extension)) candidates.add(path);
  }
  for (const attachment of managed.values()) {
    if (present.has(attachment.path) && !attachment.publicUploadApproved) candidates.add(attachment.path);
  }
  return [...candidates]
    .filter((path) => managed.get(path)?.publicUploadApproved !== true)
    .map((path) => ({
      path,
      kind: "researchCopyright" as const,
      severity: "block" as const,
      message: `Research attachment “${managed.get(path)?.name ?? basename(path)}” has not been explicitly approved for publication. It will remain blocked from a public repository.`,
      recoveryActions: ["keepResearchLocalOnly", "approveResearchUpload"] as SyncSecurityRecoveryAction[]
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function localOnlyResearchLeak(path: string, content: string): SyncSecurityFinding | null {
  if (path.replace(/\\/g, "/").toLocaleLowerCase("en-US") !== ".latex-project.json") return null;
  try {
    const value = JSON.parse(content) as { schemaVersion?: unknown; researchItems?: unknown };
    if (value.schemaVersion !== 3 || !Array.isArray(value.researchItems)) return null;
    for (const item of value.researchItems) {
      if (!item || typeof item !== "object" || !Array.isArray((item as { attachments?: unknown }).attachments)) continue;
      for (const attachment of (item as { attachments: unknown[] }).attachments) {
        if (!attachment || typeof attachment !== "object") continue;
        const candidate = attachment as Record<string, unknown>;
        if (candidate.availability !== "localOnly") continue;
        if (["relativePath", "externalPath", "localPath", "absolutePath", "gitBlobSha"].some((key) => key in candidate)) {
          return {
            path,
            kind: "sensitiveFile",
            severity: "block",
            message: "Local-only research attachments must not expose a local path or Git object in .latex-project.json. Save the research metadata again before syncing."
          };
        }
      }
    }
  } catch {
    // Invalid project metadata is handled by the project-index parser. The
    // general secret scanner still checks its text below.
  }
  return null;
}

/**
 * Scan a stable content snapshot. Git synchronization uses this entry point
 * with blobs read from the candidate index tree, so the approved bytes are
 * exactly the bytes that can be committed.
 */
export async function scanSyncSecuritySnapshot(
  changes: GitHubChangedFile[],
  largeFiles: GitHubLargeFile[],
  loadContent: SyncSecurityContentLoader
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

    const bytes = await loadContent(change.path);
    if (!bytes || bytes.length > MAX_TEXT_SCAN_BYTES || bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    const researchLeak = localOnlyResearchLeak(change.path, content);
    if (researchLeak) findings.push(researchLeak);
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

export async function scanSyncSecurity(
  root: string,
  changes: GitHubChangedFile[],
  largeFiles: GitHubLargeFile[]
): Promise<SyncSecurityFinding[]> {
  return scanSyncSecuritySnapshot(changes, largeFiles, async (path) => {
    const absolute = resolve(root, ...path.split("/"));
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_TEXT_SCAN_BYTES) return null;
    return readFile(absolute);
  });
}
