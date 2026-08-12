import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import type { ProjectSearchIndexStatus, ProjectSummary, ResearchSearchHit } from "../../shared/types";
import { ProjectCatalog } from "./catalog";

const INDEXED_TEXT_EXTENSIONS = new Set([".tex", ".bib", ".cls", ".sty", ".md", ".txt"]);
const IGNORED_DIRECTORIES = new Set([".git", ".latex-workbench", "node_modules", "dist", "dist-web", "build", "out"]);
const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;

function portable(value: string): string { return value.split(sep).join("/"); }
function hitId(projectId: string, kind: string, path: string, line: number, title: string): string {
  return createHash("sha256").update(`${projectId}\0${kind}\0${path}\0${line}\0${title}`).digest("hex");
}
function newlineOffsets(content: string): number[] {
  const offsets: number[] = [];
  for (let index = content.indexOf("\n"); index >= 0; index = content.indexOf("\n", index + 1)) offsets.push(index);
  return offsets;
}

function lineAt(offsets: number[], offset: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return low + 1;
}

function parseText(projectId: string, path: string, content: string): ResearchSearchHit[] {
  const lines = newlineOffsets(content);
  const hits: ResearchSearchHit[] = [{ id: hitId(projectId, "file", path, 0, path), projectId, kind: "file", title: path, relativePath: path, score: 0 }];
  const add = (kind: ResearchSearchHit["kind"], title: string, index: number, detail?: string) => {
    const line = lineAt(lines, index);
    hits.push({ id: hitId(projectId, kind, path, line, title), projectId, kind, title, detail, relativePath: path, line, score: 0 });
  };
  if (extname(path).toLocaleLowerCase("en-US") === ".bib") {
    const entry = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|$)/g;
    for (let match = entry.exec(content); match; match = entry.exec(content)) {
      const title = /\btitle\s*=\s*[{"]([^}"]+)/i.exec(match[3])?.[1]?.trim();
      add("bib", match[2], match.index, title ? `${match[1]} · ${title}` : match[1]);
    }
    return hits;
  }
  const heading = /\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g;
  for (let match = heading.exec(content); match; match = heading.exec(content)) add("heading", match[2].trim(), match.index, match[1]);
  const label = /\\label\s*\{([^{}]+)\}/g;
  for (let match = label.exec(content); match; match = label.exec(content)) add("label", match[1].trim(), match.index);
  const citation = /\\(?:cite\w*|autocite|parencite|textcite)(?:\[[^\]]*\])*\s*\{([^{}]+)\}/g;
  for (let match = citation.exec(content); match; match = citation.exec(content)) {
    for (const key of match[1].split(",").map((value) => value.trim()).filter(Boolean)) add("citation", key, match.index);
  }
  return hits;
}

export class ProjectSearchIndexService {
  constructor(private readonly catalog: ProjectCatalog) {}

  async index(project: ProjectSummary): Promise<ProjectSearchIndexStatus> {
    const root = await realpath(resolve(project.rootPath));
    const prior = this.catalog.searchSourceState(project.id);
    const seen = new Set<string>();
    const changed: Array<{ path: string; size: number; modifiedMs: number; hash: string; hits: ResearchSearchHit[] }> = [];
    let indexedFiles = 0;
    let skippedFiles = 0;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (seen.size >= MAX_FILES) return;
        if (entry.isSymbolicLink()) continue;
        const absolute = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase("en-US"))) await walk(absolute, depth + 1);
          continue;
        }
        if (!entry.isFile() || !INDEXED_TEXT_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("en-US"))) continue;
        const path = portable(relative(root, absolute));
        const metadata = await lstat(absolute);
        seen.add(path);
        if (metadata.size > MAX_FILE_BYTES) { skippedFiles += 1; continue; }
        const old = prior[path];
        if (old && old.size === metadata.size && old.modifiedMs === metadata.mtimeMs) { indexedFiles += 1; continue; }
        try {
          const bytes = await readFile(absolute);
          const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const hash = createHash("sha256").update(bytes).digest("hex");
          changed.push({ path, size: metadata.size, modifiedMs: metadata.mtimeMs, hash, hits: parseText(project.id, path, content) });
          indexedFiles += 1;
        } catch {
          skippedFiles += 1;
        }
      }
    };
    await walk(root, 0);
    const removed = Object.keys(prior).filter((path) => !seen.has(path));
    this.catalog.updateSearchDocuments(project.id, changed, removed, {
      id: `project:${project.id}`, projectId: project.id, kind: "project", title: project.name,
      detail: [project.rootPath, project.description, ...project.tags, ...project.classNames].filter(Boolean).join(" · "), score: 0
    });
    return { projectId: project.id, indexedFiles, skippedFiles, removedFiles: removed.length, indexedAt: new Date().toISOString() };
  }

  search(query: string, projectIds?: string[], limit?: number): ResearchSearchHit[] {
    return this.catalog.search(query, projectIds, limit);
  }
}
