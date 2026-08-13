import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

import { parseProjectResearchItems } from "../../shared/schema";
import type {
  CatalogProjectResearchItem,
  GitHubRepositoryVisibility,
  LegacyResearchCandidate,
  MobileProjectIndex,
  ProjectManifest,
  ProjectResearchItem,
  ResearchAttachment,
  ResearchSaveRequest,
  ResearchWork
} from "../../shared/types";
import { ProjectCatalog } from "./catalog";
import { MobileIndexService } from "./mobile-index";

const LEGACY_DIRECTORY = "references";
const MAX_LEGACY_FILES = 10_000;
const MAX_LEGACY_DEPTH = 32;
const MAX_HASH_CACHE_ENTRIES = 5_000;
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".epub", ".djvu", ".mobi", ".azw3", ".doc", ".docx", ".odt", ".rtf",
  ".txt", ".md", ".html", ".htm", ".tex", ".bib", ".zip"
]);

function portable(value: string): string { return value.split(sep).join("/"); }

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !/^[a-zA-Z]:|^[\\/]/.test(relation));
}

function mediaType(path: string): string {
  switch (extname(path).toLocaleLowerCase("en-US")) {
    case ".pdf": return "application/pdf";
    case ".epub": return "application/epub+zip";
    case ".djvu": return "image/vnd.djvu";
    case ".bib": return "application/x-bibtex";
    case ".tex": return "application/x-tex";
    case ".zip": return "application/zip";
    case ".txt": case ".md": return "text/plain";
    default: return "application/octet-stream";
  }
}

const hashCache = new Map<string, { size: number; modifiedMs: number; hash: string }>();

/** Hash large source documents without ever loading the whole attachment into memory. */
async function sha256(path: string): Promise<string> {
  let before = await stat(path);
  const cached = hashCache.get(path);
  if (cached && cached.size === before.size && cached.modifiedMs === before.mtimeMs) {
    // Refresh insertion order so the map also behaves as a small LRU cache.
    hashCache.delete(path);
    hashCache.set(path, cached);
    return cached.hash;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
    const after = await stat(path);
    if (before.size === after.size && before.mtimeMs === after.mtimeMs) {
      const hash = digest.digest("hex");
      hashCache.set(path, { size: after.size, modifiedMs: after.mtimeMs, hash });
      while (hashCache.size > MAX_HASH_CACHE_ENTRIES) hashCache.delete(hashCache.keys().next().value!);
      return hash;
    }
    before = after;
  }
  throw new Error(`Research attachment changed while its fingerprint was being calculated: ${basename(path)}`);
}

function researchIdentity(item: ProjectResearchItem): string | null {
  if (item.doi) return `doi:${item.doi.trim().toLocaleLowerCase()}`;
  if (item.arxivId) return `arxiv:${item.arxivId.trim().toLocaleLowerCase()}`;
  if (item.isbn) return `isbn:${item.isbn.replace(/[-\s]/g, "").toLocaleLowerCase()}`;
  const hash = item.attachments.find((attachment) => attachment.sha256)?.sha256;
  return hash ? `sha256:${hash.toLocaleLowerCase()}` : null;
}

function assertUniqueIds(items: ProjectResearchItem[]): void {
  const itemIds = new Set<string>();
  const attachmentIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) throw new Error(`Research item ID is duplicated: ${item.id}`);
    itemIds.add(item.id);
    for (const attachment of item.attachments) {
      if (attachmentIds.has(attachment.id)) throw new Error(`Research attachment ID is duplicated across the project: ${attachment.id}`);
      attachmentIds.add(attachment.id);
    }
  }
}

export class ResearchService {
  constructor(private readonly catalog: ProjectCatalog, private readonly mobileIndex = new MobileIndexService()) {}

  list(projectId: string): CatalogProjectResearchItem[] {
    return this.catalog.researchItems(projectId);
  }

  listGlobal(): CatalogProjectResearchItem[] {
    return this.catalog.researchItems();
  }

  async attachmentPath(projectId: string, projectRoot: string, itemId: string, attachmentId: string): Promise<string> {
    const entry = this.catalog.researchItems(projectId).find((candidate) => candidate.item.id === itemId);
    if (!entry) throw new Error("Research material was not found.");
    const attachment = entry.item.attachments.find((candidate) => candidate.id === attachmentId);
    if (!attachment) throw new Error("Research attachment was not found.");
    const root = await realpath(resolve(projectRoot));
    if (attachment.availability === "repository") {
      const candidate = resolve(root, ...attachment.relativePath!.split("/"));
      const [canonical, details] = await Promise.all([realpath(candidate), lstat(candidate)]);
      if (!isInside(root, canonical) || details.isSymbolicLink() || !details.isFile()) {
        throw new Error("Research attachment is not a safe project file.");
      }
      return canonical;
    }
    const localPath = entry.localAttachmentPaths[attachment.id];
    if (!localPath) throw new Error("This local-only attachment is not available on this computer.");
    const canonical = await realpath(resolve(localPath));
    const details = await lstat(canonical);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error("Local-only research attachment is unavailable.");
    return canonical;
  }

  async discoverLegacy(projectId: string, projectRoot: string): Promise<LegacyResearchCandidate[]> {
    const root = await realpath(resolve(projectRoot));
    const directory = resolve(root, LEGACY_DIRECTORY);
    try {
      const metadata = await lstat(directory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) return [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const known = this.catalog.researchItems(projectId);
    const byHash = new Map<string, string[]>();
    for (const entry of known) for (const attachment of entry.item.attachments) {
      if (attachment.sha256) byHash.set(attachment.sha256.toLocaleLowerCase(), [...(byHash.get(attachment.sha256.toLocaleLowerCase()) ?? []), entry.item.id]);
    }
    const result: LegacyResearchCandidate[] = [];
    const walk = async (current: string, depth: number): Promise<void> => {
      if (depth > MAX_LEGACY_DEPTH) throw new Error("The references directory is nested too deeply to scan safely.");
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (result.length >= MAX_LEGACY_FILES) throw new Error("The references directory contains too many files to scan safely.");
        const path = resolve(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await walk(path, depth + 1); continue; }
        if (!entry.isFile() || !ALLOWED_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("en-US"))) continue;
        const canonical = await realpath(path);
        if (!isInside(directory, canonical) || !isInside(root, canonical)) continue;
        const details = await stat(canonical);
        const hash = await sha256(canonical);
        result.push({
          relativePath: portable(relative(root, canonical)), name: basename(canonical), size: details.size,
          modifiedAt: details.mtime.toISOString(), mediaType: mediaType(canonical), sha256: hash,
          duplicateItemIds: [...(byHash.get(hash) ?? [])], pendingTargetAssignment: true
        });
      }
    };
    await walk(directory, 0);
    return result.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  /**
   * Add publisher/source documents to a public project without copying them
   * into the Git worktree. The portable index only receives bibliographic
   * identity and an explicit local-only availability marker.
   */
  async importLocalOnlyFiles(
    projectId: string,
    projectRoot: string,
    manifest: ProjectManifest,
    filePaths: string[]
  ): Promise<CatalogProjectResearchItem[]> {
    if (!filePaths.length) return this.catalog.researchItems(projectId);
    const root = await realpath(resolve(projectRoot));
    const previous = this.catalog.researchItems(projectId);
    const items = previous.map((entry) => entry.item);
    const localAttachmentPaths = Object.fromEntries(previous.flatMap((entry) => Object.entries(entry.localAttachmentPaths)));
    const knownHashes = new Set(previous.flatMap((entry) => entry.item.attachments.map((attachment) => attachment.sha256?.toLocaleLowerCase())).filter((value): value is string => Boolean(value)));

    for (const inputPath of filePaths) {
      const canonical = await realpath(resolve(inputPath));
      const details = await lstat(canonical);
      if (details.isSymbolicLink() || !details.isFile()) throw new Error(`Local-only research attachment is not a regular file: ${basename(canonical)}`);
      if (isInside(root, canonical)) throw new Error("Public-project local-only material must be selected from outside the project directory.");
      const extension = extname(canonical).toLocaleLowerCase("en-US");
      if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`Unsupported research attachment type: ${extension || basename(canonical)}`);
      const hash = await sha256(canonical);
      if (knownHashes.has(hash.toLocaleLowerCase())) continue;
      knownHashes.add(hash.toLocaleLowerCase());
      const attachmentId = randomUUID();
      const fileName = basename(canonical);
      const inferredTitle = basename(canonical, extname(canonical)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
      items.push({
        id: randomUUID(),
        title: inferredTitle || fileName,
        authors: [],
        attachments: [{
          id: attachmentId,
          name: fileName,
          mediaType: mediaType(canonical),
          size: details.size,
          sha256: hash,
          availability: "localOnly"
        }],
        links: [],
        sortOrder: items.length
      });
      localAttachmentPaths[attachmentId] = canonical;
    }
    return this.save(projectId, root, manifest, { items, localAttachmentPaths }, "public");
  }

  async save(
    projectId: string,
    projectRoot: string,
    manifest: ProjectManifest,
    request: ResearchSaveRequest,
    repositoryVisibility?: GitHubRepositoryVisibility
  ): Promise<CatalogProjectResearchItem[]> {
    if (manifest.projectId !== projectId) throw new Error("The research metadata project ID does not match the project manifest.");
    if (!this.catalog.persistent) {
      throw new Error("Research changes are disabled because the local catalog is running in temporary memory mode. Repair or restore the catalog before trying again.");
    }
    const parsedInput = parseProjectResearchItems(request.items);
    const previous = this.catalog.researchItems(projectId);
    const previousAttachments = new Map(previous.flatMap((entry) => entry.item.attachments.map((attachment) => [
      `${entry.item.id}\0${attachment.id}`,
      attachment
    ] as const)));
    const localPaths = request.localAttachmentPaths ?? {};
    if (request.publicUploadApprovalIds !== undefined && !Array.isArray(request.publicUploadApprovalIds)) {
      throw new Error("Public research upload approvals are invalid.");
    }
    const approvalIds = new Set(request.publicUploadApprovalIds ?? []);
    if ([...approvalIds].some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("Public research upload approvals are invalid.");
    }
    const parsed = parsedInput.map((item) => ({
      ...item,
      attachments: item.attachments.map((attachment) => {
        const prior = previousAttachments.get(`${item.id}\0${attachment.id}`);
        const unchangedManagedPath = prior?.availability === "repository"
          && prior.relativePath === attachment.relativePath;
        const explicitlyApproved = approvalIds.has(attachment.id);
        if (repositoryVisibility !== "public" || attachment.availability !== "repository"
          || explicitlyApproved || unchangedManagedPath) {
          return {
            ...attachment,
            publicUploadApproved: attachment.availability === "repository"
              ? (explicitlyApproved || (unchangedManagedPath && prior?.publicUploadApproved === true) || undefined)
              : undefined
          };
        }
        const externalPath = localPaths[attachment.id];
        if (!externalPath) {
          throw new Error(`Public repositories keep new research files local by default. Keep “${attachment.name}” outside the project, or explicitly confirm its copyright before uploading.`);
        }
        return {
          ...attachment,
          availability: "localOnly" as const,
          relativePath: undefined,
          gitBlobSha: undefined,
          publicUploadApproved: undefined
        };
      })
    }));
    assertUniqueIds(parsed);
    const repositoryAttachmentIds = new Set(parsed.flatMap((item) => item.attachments
      .filter((attachment) => attachment.availability === "repository")
      .map((attachment) => attachment.id)));
    if ([...approvalIds].some((id) => !repositoryAttachmentIds.has(id))) {
      throw new Error("A public-upload approval does not belong to a repository research attachment in this save action.");
    }
    const root = await realpath(resolve(projectRoot));
    const localOnlyIds = new Set(parsed.flatMap((item) => item.attachments.filter((attachment) => attachment.availability === "localOnly").map((attachment) => attachment.id)));
    if (Object.keys(localPaths).some((id) => !localOnlyIds.has(id))) throw new Error("A local-only attachment path does not belong to this project research metadata.");
    const verifiedItems: ProjectResearchItem[] = [];
    for (const item of parsed) {
      const attachments: ResearchAttachment[] = [];
      const attachmentIds = new Set<string>();
      for (const attachment of item.attachments) {
        if (attachmentIds.has(attachment.id)) throw new Error(`Research attachment ID is duplicated: ${attachment.id}`);
        attachmentIds.add(attachment.id);
        if (attachment.availability === "repository") {
          const candidate = resolve(root, ...attachment.relativePath!.split("/"));
          if (!isInside(root, candidate)) throw new Error(`Research attachment escapes the project: ${attachment.relativePath}`);
          const [canonical, details] = await Promise.all([realpath(candidate), lstat(candidate)]);
          if (!isInside(root, canonical) || details.isSymbolicLink() || !details.isFile()) throw new Error(`Research attachment is not a safe regular project file: ${attachment.relativePath}`);
          attachments.push({ ...attachment, relativePath: portable(relative(root, canonical)), size: details.size, sha256: await sha256(canonical) });
        } else {
          const external = localPaths[attachment.id];
          if (!external) {
            attachments.push({ ...attachment, relativePath: undefined, size: undefined, sha256: undefined, gitBlobSha: undefined });
            continue;
          }
          const [canonical, details] = await Promise.all([realpath(resolve(external)), lstat(resolve(external))]);
          if (details.isSymbolicLink() || !details.isFile()) throw new Error(`Local-only attachment is not a regular file: ${attachment.name}`);
          if (isInside(root, canonical)) throw new Error("A local-only research attachment must remain outside the project directory so Git cannot upload it accidentally.");
          attachments.push({ ...attachment, relativePath: undefined, size: details.size, sha256: await sha256(canonical), gitBlobSha: undefined });
        }
      }
      verifiedItems.push({ ...item, attachments });
    }

    const allWorks = this.catalog.researchWorks();
    const identities = new Map<string, ResearchWork>();
    for (const work of allWorks) {
      const pseudo: ProjectResearchItem = {
        id: work.id, title: work.title, authors: work.authors ?? [], year: work.year, language: work.language,
        doi: work.doi, arxivId: work.arxivId, isbn: work.isbn, attachments: [], links: [{ targetId: null, role: "reference" }]
      };
      const identity = researchIdentity(pseudo);
      if (identity) identities.set(identity, work);
    }
    const workIdsByHash = new Map<string, string>();
    for (const entry of this.catalog.researchItems()) for (const attachment of entry.item.attachments) {
      if (attachment.sha256) workIdsByHash.set(attachment.sha256.toLocaleLowerCase(), entry.workId);
    }
    const now = new Date().toISOString();
    const entries: CatalogProjectResearchItem[] = verifiedItems.map((item) => {
      const existing = previous.find((entry) => entry.item.id === item.id);
      const identity = researchIdentity(item);
      const attachmentHash = item.attachments.find((attachment) => attachment.sha256)?.sha256?.toLocaleLowerCase();
      const workId = existing?.workId ?? (identity ? identities.get(identity)?.id : undefined)
        ?? (attachmentHash ? workIdsByHash.get(attachmentHash) : undefined) ?? randomUUID();
      const work: ResearchWork = {
        id: workId, title: item.title, authors: item.authors, year: item.year, language: item.language,
        doi: item.doi, arxivId: item.arxivId, isbn: item.isbn,
        createdAt: existing?.createdAt ?? now, updatedAt: now
      };
      this.catalog.upsertResearchWork(work);
      return {
        projectId, workId, item, createdAt: existing?.createdAt ?? now, updatedAt: now,
        localAttachmentPaths: Object.fromEntries(item.attachments.filter((attachment) => attachment.availability === "localOnly" && localPaths[attachment.id]).map((attachment) => [attachment.id, localPaths[attachment.id]]))
      };
    });

    const currentIndex = await this.mobileIndex.read(root);
    const portableItems = verifiedItems.map((item) => ({
      ...item,
      attachments: item.attachments.map((attachment) => attachment.availability === "localOnly"
        ? { id: attachment.id, name: attachment.name, mediaType: attachment.mediaType, versionLabel: attachment.versionLabel, availability: "localOnly" as const }
        : attachment)
    }));
    const nextIndex: MobileProjectIndex = currentIndex
      ? { ...currentIndex, schemaVersion: 3, researchItems: portableItems }
      : { schemaVersion: 3, projectId, name: manifest.name, updatedAt: now, outputs: [], researchItems: portableItems };
    const stored = this.catalog.replaceResearchItems(projectId, entries);
    try {
      await this.mobileIndex.write(root, manifest, nextIndex);
      return stored;
    } catch (error) {
      this.catalog.replaceResearchItems(projectId, previous);
      throw error;
    }
  }
}
