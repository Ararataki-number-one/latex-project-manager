import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  DesktopMigrationApplyOptions,
  DesktopMigrationConflict,
  DesktopMigrationPreview,
  DesktopMigrationProjectCandidate,
  DesktopMigrationResult,
  DesktopMigrationSource,
  ProjectLifecycle,
  ProjectProtectionState,
  ProjectSummary
} from "../../shared/types";
import {
  CATALOG_SCHEMA_VERSION,
  ProjectCatalog,
  type CatalogMigrationProjectIdRemap,
  type CatalogMigrationSourceData
} from "./catalog";

interface LoadedSource {
  source: DesktopMigrationSource & { databasePath: string };
  schemaVersion: number;
  fingerprint: string;
  projects: ProjectSummary[];
  tables: Record<string, Array<Record<string, unknown>>>;
}

interface SeenProject {
  project: ProjectSummary;
  canonicalRoot: string;
}

const LIFECYCLES = new Set<ProjectLifecycle>(["active", "paused", "completed", "archived"]);
const PROTECTION_STATES = new Set<ProjectProtectionState>(["unprotected", "localBackup", "github", "both"]);
const PORTABLE_CATALOG_TABLES = [
  "sync_events", "app_settings", "collections", "collection_projects", "smart_views",
  "file_operation_history", "research_works", "project_research_items", "search_documents",
  "search_sources", "operation_snapshots", "project_status_snapshots"
] as const;

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function cloneProject(project: ProjectSummary): ProjectSummary {
  return { ...project, classNames: [...project.classNames], tags: [...project.tags] };
}

/** Resolve aliases and casing so the same physical project is not imported twice. */
export function canonicalProjectRoot(rootPath: string): string {
  const absolute = resolve(rootPath);
  let canonical = absolute;
  try {
    canonical = realpathSync.native(absolute);
  } catch {
    // Missing projects are still comparable by a normalized absolute path.
  }
  return process.platform === "win32" ? canonical.toLocaleLowerCase("en-US") : canonical;
}

function fingerprintDatabase(databasePath: string): string {
  const hash = createHash("sha256");
  for (const path of [databasePath, `${databasePath}-wal`]) {
    hash.update(path.endsWith("-wal") ? "wal\0" : "database\0");
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

function sourceProjectFromRow(row: Record<string, unknown>): ProjectSummary {
  const archivedColumn = Number(row.archived ?? 0) === 1;
  const storedLifecycle = typeof row.lifecycle === "string" && LIFECYCLES.has(row.lifecycle as ProjectLifecycle)
    ? row.lifecycle as ProjectLifecycle
    : undefined;
  const lifecycle: ProjectLifecycle = archivedColumn || storedLifecycle === "archived"
    ? "archived"
    : (storedLifecycle ?? "active");
  const protectionState = typeof row.protection_state === "string"
    && PROTECTION_STATES.has(row.protection_state as ProjectProtectionState)
    ? row.protection_state as ProjectProtectionState
    : "unprotected";
  const rootPath = String(row.root_path ?? "");
  if (!rootPath) throw new Error(`Source project ${String(row.id ?? "(unknown)")} has no root path.`);
  return {
    id: String(row.id),
    name: String(row.name ?? row.id),
    rootPath,
    targetCount: Number(row.target_count ?? 0),
    classNames: parseStringArray(row.class_names),
    lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : undefined,
    lastBuildAt: row.last_build_at ? String(row.last_build_at) : undefined,
    lastBuildStatus: row.last_build_status ? row.last_build_status as ProjectSummary["lastBuildStatus"] : undefined,
    favorite: Number(row.favorite ?? 0) === 1,
    archived: lifecycle === "archived",
    trashed: Number(row.trashed ?? 0) === 1,
    trashedAt: row.trashed_at ? String(row.trashed_at) : undefined,
    tags: parseStringArray(row.tags),
    thumbnailPath: row.thumbnail_path ? String(row.thumbnail_path) : undefined,
    pathAvailable: existsSync(rootPath),
    description: row.description ? String(row.description) : "",
    lifecycle,
    protectionState
  };
}

function loadSource(input: DesktopMigrationSource): LoadedSource {
  const databasePath = resolve(input.databasePath);
  if (!existsSync(databasePath)) throw new Error(`Migration source does not exist: ${databasePath}`);
  const fingerprintBefore = fingerprintDatabase(databasePath);
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  let schemaVersion = 0;
  let projects: ProjectSummary[] = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check?: string }>;
    if (!integrity.length || integrity.some((row) => row.integrity_check !== "ok")) {
      throw new Error(`Migration source failed SQLite integrity validation: ${databasePath}`);
    }
    schemaVersion = Number((database.prepare("PRAGMA user_version").get() as { user_version?: number })?.user_version ?? 0);
    if (schemaVersion < 1 || schemaVersion > CATALOG_SCHEMA_VERSION) {
      throw new Error(`Unsupported migration source schema ${schemaVersion}: ${databasePath}`);
    }
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
    if (!table) throw new Error(`Migration source has no projects table: ${databasePath}`);
    projects = (database.prepare("SELECT * FROM projects").all() as Array<Record<string, unknown>>)
      .map(sourceProjectFromRow);
    const tableRows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{ name?: string }>;
    const availableTables = new Set(tableRows.map((row) => row.name)
      .filter((name): name is string => Boolean(name)));
    for (const tableName of PORTABLE_CATALOG_TABLES) {
      tables[tableName] = availableTables.has(tableName)
        ? database.prepare(`SELECT * FROM ${tableName}`).all() as Array<Record<string, unknown>>
        : [];
    }
  } finally {
    database.close();
  }
  const fingerprint = fingerprintDatabase(databasePath);
  if (fingerprint !== fingerprintBefore) {
    throw new Error(`Migration source changed while it was being inspected: ${databasePath}`);
  }
  return { source: { ...input, databasePath }, schemaVersion, fingerprint, projects, tables };
}

function stableId(...values: string[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 32);
}

function persistedProjectShape(project: ProjectSummary): unknown {
  return {
    id: project.id, name: project.name, rootPath: canonicalProjectRoot(project.rootPath),
    targetCount: project.targetCount, classNames: [...project.classNames].sort(),
    lastOpenedAt: project.lastOpenedAt, lastBuildAt: project.lastBuildAt,
    lastBuildStatus: project.lastBuildStatus, favorite: project.favorite,
    archived: project.archived, trashed: project.trashed, trashedAt: project.trashedAt,
    tags: [...project.tags].sort(), thumbnailPath: project.thumbnailPath,
    description: project.description, lifecycle: project.lifecycle,
    protectionState: project.protectionState
  };
}

function buildPreviewId(
  targetDatabasePath: string,
  targetProjects: ProjectSummary[],
  sources: LoadedSource[],
  candidates: DesktopMigrationProjectCandidate[],
  conflicts: DesktopMigrationConflict[]
): string {
  return createHash("sha256").update(JSON.stringify({
    targetDatabasePath: resolve(targetDatabasePath),
    targetProjects: targetProjects.map(persistedProjectShape).sort((left: any, right: any) => left.id.localeCompare(right.id)),
    sources: sources.map(({ source, schemaVersion, fingerprint }) => ({
      kind: source.kind, databasePath: source.databasePath, schemaVersion, fingerprint
    })),
    candidates: candidates.map(({ id, action, destinationProjectId, conflictId }) => ({
      id, action, destinationProjectId, conflictId
    })),
    conflicts: conflicts.map(({ id, kind, canonicalRoot, sourceProject, destinationProject }) => ({
      id, kind, canonicalRoot, sourceProjectId: sourceProject.id, destinationProjectId: destinationProject.id
    }))
  })).digest("hex");
}

export function previewDesktopCatalogMigration(
  targetCatalog: ProjectCatalog,
  sourceInputs: DesktopMigrationSource[]
): DesktopMigrationPreview {
  const targetDatabasePath = resolve(targetCatalog.databasePath);
  const uniqueSources = new Set<string>();
  const sources = sourceInputs.map((source) => {
    const normalized = resolve(source.databasePath);
    const key = process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
    const targetKey = process.platform === "win32" ? targetDatabasePath.toLocaleLowerCase("en-US") : targetDatabasePath;
    if (key === targetKey) throw new Error("The active catalog cannot also be a migration source.");
    if (uniqueSources.has(key)) throw new Error(`Duplicate migration source: ${normalized}`);
    uniqueSources.add(key);
    return loadSource(source);
  });

  const targetProjects = targetCatalog.list();
  const byId = new Map<string, SeenProject>();
  const byRoot = new Map<string, SeenProject>();
  for (const project of targetProjects) {
    const seen = { project: cloneProject(project), canonicalRoot: canonicalProjectRoot(project.rootPath) };
    byId.set(project.id, seen);
    byRoot.set(seen.canonicalRoot, seen);
  }

  const projects: DesktopMigrationProjectCandidate[] = [];
  const conflicts: DesktopMigrationConflict[] = [];
  const warnings: string[] = [];
  for (const loaded of sources) {
    if (!loaded.projects.length) warnings.push(`${loaded.source.label ?? loaded.source.kind} contains no projects.`);
    const portableRows = Object.values(loaded.tables).reduce((total, rows) => total + rows.length, 0);
    warnings.push(
      `${loaded.source.label ?? loaded.source.kind}: ${portableRows} related SQLite records will be merged; `
      + "files outside the catalog database remain untouched in their original user-data folder and are not deleted."
    );
    for (const sourceProject of loaded.projects) {
      const canonicalRoot = canonicalProjectRoot(sourceProject.rootPath);
      const rootMatch = byRoot.get(canonicalRoot);
      const idMatch = byId.get(sourceProject.id);
      const candidateId = stableId(loaded.source.kind, loaded.source.databasePath, sourceProject.id, canonicalRoot);
      if (rootMatch && idMatch && rootMatch.project.id === idMatch.project.id) {
        projects.push({
          id: candidateId, sourceKind: loaded.source.kind, sourceDatabasePath: loaded.source.databasePath,
          sourceProject: cloneProject(sourceProject), canonicalRoot, action: "merge",
          destinationProjectId: rootMatch.project.id
        });
        continue;
      }
      if (rootMatch || idMatch) {
        const destination = rootMatch ?? idMatch!;
        const kind = rootMatch ? "sameRootDifferentProject" : "sameProjectDifferentRoot";
        const conflictId = stableId("conflict", kind, candidateId, destination.project.id, destination.canonicalRoot);
        conflicts.push({
          id: conflictId, kind, canonicalRoot, sourceProject: cloneProject(sourceProject),
          destinationProject: cloneProject(destination.project), sourceKind: loaded.source.kind,
          resolutionOptions: ["keepTarget", "useSource"]
        });
        projects.push({
          id: candidateId, sourceKind: loaded.source.kind, sourceDatabasePath: loaded.source.databasePath,
          sourceProject: cloneProject(sourceProject), canonicalRoot, action: "conflict",
          destinationProjectId: destination.project.id, conflictId
        });
        continue;
      }
      const seen = { project: cloneProject(sourceProject), canonicalRoot };
      byId.set(sourceProject.id, seen);
      byRoot.set(canonicalRoot, seen);
      projects.push({
        id: candidateId, sourceKind: loaded.source.kind, sourceDatabasePath: loaded.source.databasePath,
        sourceProject: cloneProject(sourceProject), canonicalRoot, action: "import"
      });
    }
  }

  const id = buildPreviewId(targetDatabasePath, targetProjects, sources, projects, conflicts);
  return {
    id, createdAt: new Date().toISOString(), targetDatabasePath,
    sources: sources.map(({ source, schemaVersion, fingerprint }) => ({ ...source, schemaVersion, fingerprint })),
    projects, conflicts, warnings
  };
}

function newerDate(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
}

function protectionFlags(state?: ProjectProtectionState): { local: boolean; github: boolean } {
  return {
    local: state === "localBackup" || state === "both",
    github: state === "github" || state === "both"
  };
}

function mergeProtection(left?: ProjectProtectionState, right?: ProjectProtectionState): ProjectProtectionState {
  const first = protectionFlags(left); const second = protectionFlags(right);
  const local = first.local || second.local; const github = first.github || second.github;
  return local && github ? "both" : local ? "localBackup" : github ? "github" : "unprotected";
}

/** Merge portable metadata while keeping the first project's identity and root. */
export function mergeMigrationProjectMetadata(primary: ProjectSummary, secondary: ProjectSummary): ProjectSummary {
  const lastBuildAt = newerDate(primary.lastBuildAt, secondary.lastBuildAt);
  const lifecycle: ProjectLifecycle = primary.lifecycle === "archived" || secondary.lifecycle === "archived"
    ? "archived"
    : primary.lifecycle && primary.lifecycle !== "active"
      ? primary.lifecycle
      : (secondary.lifecycle ?? "active");
  return {
    ...primary,
    name: primary.name.trim() || secondary.name,
    targetCount: Math.max(primary.targetCount, secondary.targetCount),
    classNames: [...new Set([...primary.classNames, ...secondary.classNames])],
    lastOpenedAt: newerDate(primary.lastOpenedAt, secondary.lastOpenedAt),
    lastBuildAt,
    lastBuildStatus: lastBuildAt === secondary.lastBuildAt ? secondary.lastBuildStatus : primary.lastBuildStatus,
    favorite: primary.favorite || secondary.favorite,
    archived: lifecycle === "archived",
    tags: [...new Set([...primary.tags, ...secondary.tags])],
    thumbnailPath: primary.thumbnailPath ?? secondary.thumbnailPath,
    description: primary.description?.trim() ? primary.description : (secondary.description ?? ""),
    lifecycle,
    protectionState: mergeProtection(primary.protectionState, secondary.protectionState)
  };
}

interface WorkingTargetProjects {
  byId: Map<string, ProjectSummary>;
  byRoot: Map<string, ProjectSummary>;
}

function workingTargetProjects(projects: ProjectSummary[]): WorkingTargetProjects {
  const working: WorkingTargetProjects = { byId: new Map(), byRoot: new Map() };
  for (const source of projects) {
    const project = cloneProject(source);
    working.byId.set(project.id, project);
    working.byRoot.set(canonicalProjectRoot(project.rootPath), project);
  }
  return working;
}

function findWorkingDestination(
  working: WorkingTargetProjects,
  candidate: DesktopMigrationProjectCandidate
): ProjectSummary | undefined {
  const byId = candidate.destinationProjectId ? working.byId.get(candidate.destinationProjectId) : undefined;
  return byId ?? working.byRoot.get(candidate.canonicalRoot);
}

/** Mirror the identity/root replacement semantics of ProjectCatalog.upsert. */
function recordWorkingProject(working: WorkingTargetProjects, source: ProjectSummary): ProjectSummary {
  const project = cloneProject(source);
  const previousId = working.byId.get(project.id);
  if (previousId) working.byRoot.delete(canonicalProjectRoot(previousId.rootPath));
  const canonicalRoot = canonicalProjectRoot(project.rootPath);
  const previousRoot = working.byRoot.get(canonicalRoot);
  if (previousRoot && previousRoot.id !== project.id) working.byId.delete(previousRoot.id);
  working.byId.set(project.id, project);
  working.byRoot.set(canonicalRoot, project);
  return project;
}

export function applyDesktopCatalogMigration(
  targetCatalog: ProjectCatalog,
  preview: DesktopMigrationPreview,
  options: DesktopMigrationApplyOptions
): Omit<DesktopMigrationResult, "localResources" | "warnings"> {
  if (!targetCatalog.status().writable) throw new Error("The target catalog is not writable.");
  if (resolve(preview.targetDatabasePath) !== resolve(targetCatalog.databasePath)) {
    throw new Error("Migration preview belongs to a different target catalog.");
  }
  const fresh = previewDesktopCatalogMigration(targetCatalog, preview.sources.map(({ kind, databasePath, label }) => ({
    kind, databasePath, label
  })));
  if (fresh.id !== preview.id) {
    throw new Error("Migration preview is stale because a source or the target catalog changed. Create a new preview.");
  }
  for (const conflict of fresh.conflicts) {
    const resolution = options.resolutions[conflict.id];
    if (!resolution || !conflict.resolutionOptions.includes(resolution)) {
      throw new Error(`Migration conflict requires an explicit resolution: ${conflict.id}`);
    }
  }

  const backupPath = `${targetCatalog.databasePath}.pre-desktop-migration-${Date.now()}-${randomUUID()}.bak`;
  targetCatalog.backupTo(backupPath);
  const working = workingTargetProjects(targetCatalog.list());
  const sourceProjectIds = new Map<string, Record<string, string>>();
  const targetRemaps: CatalogMigrationProjectIdRemap[] = [];
  const sourceMap = (databasePath: string): Record<string, string> => {
    const normalized = resolve(databasePath);
    let mapping = sourceProjectIds.get(normalized);
    if (!mapping) { mapping = {}; sourceProjectIds.set(normalized, mapping); }
    return mapping;
  };
  let imported = 0; let merged = 0; let skipped = 0;
  for (const candidate of fresh.projects) {
    if (candidate.action === "import") {
      const stored = recordWorkingProject(working, candidate.sourceProject);
      sourceMap(candidate.sourceDatabasePath)[candidate.sourceProject.id] = stored.id;
      imported += 1;
      continue;
    }
    const destination = findWorkingDestination(working, candidate);
    if (candidate.action === "merge") {
      if (!destination) throw new Error(`Migration destination disappeared: ${candidate.destinationProjectId}`);
      const stored = recordWorkingProject(
        working,
        mergeMigrationProjectMetadata(destination, candidate.sourceProject)
      );
      sourceMap(candidate.sourceDatabasePath)[candidate.sourceProject.id] = stored.id;
      merged += 1;
      continue;
    }
    const resolution = options.resolutions[candidate.conflictId!];
    if (resolution === "keepTarget") {
      if (!destination) throw new Error(`Migration conflict destination disappeared: ${candidate.destinationProjectId}`);
      sourceMap(candidate.sourceDatabasePath)[candidate.sourceProject.id] = destination.id;
      skipped += 1;
      continue;
    }
    if (!destination) throw new Error(`Migration conflict destination disappeared: ${candidate.destinationProjectId}`);
    const stored = recordWorkingProject(
      working,
      mergeMigrationProjectMetadata(candidate.sourceProject, destination)
    );
    sourceMap(candidate.sourceDatabasePath)[candidate.sourceProject.id] = stored.id;
    if (destination.id !== stored.id) {
      targetRemaps.push({ fromProjectId: destination.id, toProjectId: stored.id });
      for (const mapping of sourceProjectIds.values()) {
        for (const [sourceId, targetId] of Object.entries(mapping)) {
          if (targetId === destination.id) mapping[sourceId] = stored.id;
        }
      }
    }
    merged += 1;
  }
  const loadedSources = preview.sources.map(({ kind, databasePath, label }) => loadSource({ kind, databasePath, label }));
  const migrationSources: CatalogMigrationSourceData[] = loadedSources.map((source) => ({
    databasePath: source.source.databasePath,
    tables: source.tables,
    projectIds: sourceMap(source.source.databasePath)
  }));
  targetCatalog.applyDesktopMigrationAtomically([...working.byId.values()], migrationSources, targetRemaps);
  return { backupPath, imported, merged, skipped, appliedAt: new Date().toISOString() };
}
