import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AppRuntimeSettings,
  BuildStatus,
  CatalogStatus,
  GitHubSyncEvent,
  ProjectCollection,
  ProjectManifest,
  ProjectFileOperationHistoryEntry,
  ProjectSummary,
  SmartView
} from "../../shared/types";

interface CatalogRow {
  id: string;
  name: string;
  root_path: string;
  target_count: number;
  class_names: string;
  last_opened_at: string | null;
  last_build_at: string | null;
  last_build_status: string | null;
  favorite: number;
  archived: number;
  trashed: number;
  trashed_at: string | null;
  tags: string;
  thumbnail_path: string | null;
  description: string;
}

const BUILD_STATUSES = new Set<BuildStatus>([
  "idle",
  "queued",
  "running",
  "success",
  "warning",
  "failed",
  "cancelled"
]);

const DEFAULT_RUNTIME_SETTINGS: AppRuntimeSettings = {
  closeToTray: true,
  onboardingCompleted: false,
  syncPaused: false,
  theme: "system",
  density: "comfortable",
  glassMode: "auto"
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(row: CatalogRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    targetCount: row.target_count,
    classNames: parseStringArray(row.class_names),
    lastOpenedAt: row.last_opened_at ?? undefined,
    lastBuildAt: row.last_build_at ?? undefined,
    lastBuildStatus: BUILD_STATUSES.has(row.last_build_status as BuildStatus)
      ? (row.last_build_status as BuildStatus)
      : undefined,
    favorite: row.favorite === 1,
    archived: row.archived === 1,
    trashed: row.trashed === 1,
    trashedAt: row.trashed_at ?? undefined,
    tags: parseStringArray(row.tags),
    thumbnailPath: row.thumbnail_path ?? undefined,
    pathAvailable: existsSync(row.root_path)
    ,description: row.description
  };
}

function cloneSummary(summary: ProjectSummary): ProjectSummary {
  return { ...summary, classNames: [...summary.classNames], tags: [...summary.tags] };
}

export function projectSummaryFromManifest(
  rootPath: string,
  manifest: ProjectManifest,
  previous?: ProjectSummary
): ProjectSummary {
  return {
    id: manifest.projectId,
    name: previous?.name ?? manifest.name,
    rootPath,
    targetCount: manifest.targets.length,
    classNames: [...new Set(manifest.targets.map((target) => target.classConfig.name))],
    lastOpenedAt: previous?.lastOpenedAt,
    lastBuildAt: previous?.lastBuildAt,
    lastBuildStatus: previous?.lastBuildStatus,
    favorite: previous?.favorite ?? false,
    archived: previous?.archived ?? false,
    trashed: previous?.trashed ?? false,
    trashedAt: previous?.trashedAt,
    tags: previous?.tags ?? [],
    thumbnailPath: previous?.thumbnailPath,
    pathAvailable: existsSync(rootPath),
    description: previous?.description ?? ""
  };
}

export class ProjectCatalog {
  private readonly memory = new Map<string, ProjectSummary>();
  private readonly memorySyncEvents = new Map<string, GitHubSyncEvent[]>();
  private memoryRuntimeSettings: AppRuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  private readonly memoryCollections = new Map<string, ProjectCollection>();
  private readonly memorySmartViews = new Map<string, SmartView>();
  private database: DatabaseSync | null = null;
  readonly fallbackReason?: string;
  private readonly migrationWarnings: string[] = [];
  private migrationBackupPath?: string;

  constructor(public readonly databasePath: string) {
    let fallbackReason: string | undefined;
    try {
      mkdirSync(dirname(databasePath), { recursive: true });
      const databaseExisted = existsSync(databasePath);
      this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
      const integrity = this.database.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check?: string }>;
      if (!integrity.length || integrity.some((row) => row.integrity_check !== "ok")) {
        throw new Error(`SQLite 完整性检查失败：${integrity.map((row) => row.integrity_check).filter(Boolean).join("；") || "未知错误"}`);
      }
      if (databaseExisted) {
        this.database.exec("PRAGMA wal_checkpoint(FULL)");
        const backupOne = `${databasePath}.backup-1`;
        const backupTwo = `${databasePath}.backup-2`;
        if (existsSync(backupTwo)) unlinkSync(backupTwo);
        if (existsSync(backupOne)) renameSync(backupOne, backupTwo);
        copyFileSync(databasePath, backupOne);
        this.migrationBackupPath = backupOne;
      }
      const currentVersion = Number((this.database.prepare("PRAGMA user_version").get() as { user_version?: number })?.user_version ?? 0);
      if (databaseExisted && currentVersion < 3) {
        this.database.exec("PRAGMA wal_checkpoint(FULL)");
        const backupPath = `${databasePath}.pre-v3.bak`;
        if (!existsSync(backupPath)) copyFileSync(databasePath, backupPath);
        this.migrationBackupPath = backupPath;
      }
      this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;");
      try {
        this.database.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          target_count INTEGER NOT NULL DEFAULT 0,
          class_names TEXT NOT NULL DEFAULT '[]',
          last_opened_at TEXT,
          last_build_at TEXT,
          last_build_status TEXT,
          favorite INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
          trashed INTEGER NOT NULL DEFAULT 0,
          trashed_at TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          thumbnail_path TEXT,
          description TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS projects_root_path ON projects(root_path);
        CREATE INDEX IF NOT EXISTS projects_last_opened ON projects(last_opened_at DESC);
        CREATE TABLE IF NOT EXISTS sync_events (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          state TEXT NOT NULL,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS sync_events_project_time ON sync_events(project_id, occurred_at DESC);
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_projects (
          collection_id TEXT NOT NULL, project_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (collection_id, project_id),
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS smart_views (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, filter TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS file_operation_history (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          source_path TEXT NOT NULL,
          destination_path TEXT,
          created_at TEXT NOT NULL,
          undo_expires_at TEXT,
          result TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS file_operation_project_time
          ON file_operation_history(project_id, created_at DESC);
        `);
        const columns = new Set(
          (this.database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((column) => column.name)
        );
        if (!columns.has("trashed")) this.database.exec("ALTER TABLE projects ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0");
        if (!columns.has("trashed_at")) this.database.exec("ALTER TABLE projects ADD COLUMN trashed_at TEXT");
        if (!columns.has("description")) this.database.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''");
        this.database.exec("PRAGMA user_version = 3; COMMIT;");
      } catch (error) {
        try { this.database.exec("ROLLBACK"); } catch { /* transaction already closed */ }
        throw error;
      }
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error);
      try {
        this.database?.close();
      } catch {
        // The in-memory catalog remains usable even if native SQLite cleanup fails.
      }
      this.database = null;
    }
    this.fallbackReason = fallbackReason;
  }

  get persistent(): boolean {
    return this.database !== null;
  }

  status(): CatalogStatus {
    return {
      schemaVersion: 3,
      persistent: this.persistent,
      databasePath: this.databasePath,
      backupPath: this.migrationBackupPath,
      warnings: [
        ...this.migrationWarnings,
        ...(this.fallbackReason ? [`SQLite 索引不可用，当前使用临时内存索引：${this.fallbackReason}`] : [])
      ]
    };
  }

  list(): ProjectSummary[] {
    if (!this.database) {
      return [...this.memory.values()]
        .map(cloneSummary)
        .sort((left, right) => (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? ""));
    }
    const rows = this.database
      .prepare(
        `SELECT id, name, root_path, target_count, class_names, last_opened_at, last_build_at,
                last_build_status, favorite, archived, trashed, trashed_at, tags, thumbnail_path, description
           FROM projects
          ORDER BY favorite DESC, COALESCE(last_opened_at, updated_at) DESC, name COLLATE NOCASE`
      )
      .all() as unknown as CatalogRow[];
    return rows.map(fromRow);
  }

  get(projectId: string): ProjectSummary | undefined {
    if (!this.database) {
      const summary = this.memory.get(projectId);
      return summary ? cloneSummary(summary) : undefined;
    }
    const row = this.database
      .prepare(
        `SELECT id, name, root_path, target_count, class_names, last_opened_at, last_build_at,
                last_build_status, favorite, archived, trashed, trashed_at, tags, thumbnail_path, description
           FROM projects WHERE id = ?`
      )
      .get(projectId) as CatalogRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  upsert(summary: ProjectSummary): ProjectSummary {
    const normalized = cloneSummary({ ...summary, pathAvailable: existsSync(summary.rootPath) });
    if (!this.database) {
      for (const [id, current] of this.memory) {
        if (id !== normalized.id && current.rootPath.toLowerCase() === normalized.rootPath.toLowerCase()) this.memory.delete(id);
      }
      this.memory.set(normalized.id, normalized);
      return cloneSummary(normalized);
    }
    // A project imported before its manifest is written can have a legacy ID
    // for the same root. Remove that row before the ID-based upsert so the
    // unique root_path index cannot turn migration into a database error.
    this.database.prepare("DELETE FROM projects WHERE root_path = ? AND id <> ?").run(normalized.rootPath, normalized.id);
    this.database
      .prepare(
        `INSERT INTO projects (
           id, name, root_path, target_count, class_names, last_opened_at, last_build_at,
           last_build_status, favorite, archived, trashed, trashed_at, tags, thumbnail_path, description, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           root_path = excluded.root_path,
           target_count = excluded.target_count,
           class_names = excluded.class_names,
           last_opened_at = excluded.last_opened_at,
           last_build_at = excluded.last_build_at,
           last_build_status = excluded.last_build_status,
           favorite = excluded.favorite,
           archived = excluded.archived,
           trashed = excluded.trashed,
           trashed_at = excluded.trashed_at,
           tags = excluded.tags,
           thumbnail_path = excluded.thumbnail_path,
           description = excluded.description,
           updated_at = excluded.updated_at`
      )
      .run(
        normalized.id,
        normalized.name,
        normalized.rootPath,
        normalized.targetCount,
        JSON.stringify(normalized.classNames),
        normalized.lastOpenedAt ?? null,
        normalized.lastBuildAt ?? null,
        normalized.lastBuildStatus ?? null,
        normalized.favorite ? 1 : 0,
        normalized.archived ? 1 : 0,
        normalized.trashed ? 1 : 0,
        normalized.trashedAt ?? null,
        JSON.stringify(normalized.tags),
        normalized.thumbnailPath ?? null,
        normalized.description ?? "",
        new Date().toISOString()
      );
    return this.get(normalized.id)!;
  }

  upsertManifest(rootPath: string, manifest: ProjectManifest): ProjectSummary {
    const previous = this.list().find((project) => project.rootPath.toLowerCase() === rootPath.toLowerCase());
    return this.upsert(projectSummaryFromManifest(rootPath, manifest, previous ?? this.get(manifest.projectId)));
  }

  relink(projectId: string, rootPath: string): ProjectSummary {
    const current = this.require(projectId);
    return this.upsert({ ...current, rootPath, pathAvailable: existsSync(rootPath) });
  }

  update(
    projectId: string,
    patch: Partial<Pick<ProjectSummary, "name" | "description" | "favorite" | "archived" | "trashed" | "tags">>
  ): ProjectSummary {
    const current = this.require(projectId);
    const trashedAt = patch.trashed === true
      ? (current.trashedAt ?? new Date().toISOString())
      : patch.trashed === false
        ? undefined
        : current.trashedAt;
    return this.upsert({
      ...current,
      ...patch,
      trashedAt,
      tags: patch.tags ? [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))] : current.tags
    });
  }

  markOpened(projectId: string, at = new Date().toISOString()): ProjectSummary {
    return this.upsert({ ...this.require(projectId), lastOpenedAt: at });
  }

  markBuild(projectId: string, status: BuildStatus, at = new Date().toISOString()): ProjectSummary {
    return this.upsert({ ...this.require(projectId), lastBuildAt: at, lastBuildStatus: status });
  }

  appendSyncEvent(event: GitHubSyncEvent): void {
    if (!this.database) {
      const events = [event, ...(this.memorySyncEvents.get(event.projectId) ?? [])]
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, 100);
      this.memorySyncEvents.set(event.projectId, events);
      return;
    }
    this.database.prepare(
      "INSERT OR REPLACE INTO sync_events (id, project_id, occurred_at, state, level, message) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(event.id, event.projectId, event.occurredAt, event.state, event.level, event.message);
    this.database.prepare(`
      DELETE FROM sync_events
       WHERE project_id = ?
         AND id NOT IN (
           SELECT id FROM sync_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT 100
         )
    `).run(event.projectId, event.projectId);
  }

  syncHistory(projectId: string, limit = 100): GitHubSyncEvent[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    if (!this.database) return (this.memorySyncEvents.get(projectId) ?? []).slice(0, safeLimit).map((event) => ({ ...event }));
    return this.database.prepare(`
      SELECT id, project_id, occurred_at, state, level, message
        FROM sync_events
       WHERE project_id = ?
       ORDER BY occurred_at DESC
       LIMIT ?
    `).all(projectId, safeLimit).map((row: any) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      occurredAt: String(row.occurred_at),
      state: row.state as GitHubSyncEvent["state"],
      level: row.level as GitHubSyncEvent["level"],
      message: String(row.message)
    }));
  }

  runtimeSettings(): AppRuntimeSettings {
    if (!this.database) return { ...this.memoryRuntimeSettings };
    const row = this.database.prepare("SELECT value FROM app_settings WHERE key = ?").get("runtime") as { value?: string } | undefined;
    if (!row?.value) return { ...DEFAULT_RUNTIME_SETTINGS };
    try {
      const parsed = JSON.parse(row.value) as Partial<AppRuntimeSettings>;
      return {
        closeToTray: typeof parsed.closeToTray === "boolean" ? parsed.closeToTray : true,
        onboardingCompleted: typeof parsed.onboardingCompleted === "boolean" ? parsed.onboardingCompleted : false,
        syncPaused: typeof parsed.syncPaused === "boolean" ? parsed.syncPaused : false,
        theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
        density: parsed.density === "compact" ? "compact" : "comfortable",
        glassMode: parsed.glassMode === "full" || parsed.glassMode === "off" ? parsed.glassMode : "auto"
      };
    } catch {
      return { ...DEFAULT_RUNTIME_SETTINGS };
    }
  }

  setRuntimeSettings(settings: AppRuntimeSettings): AppRuntimeSettings {
    const normalized: AppRuntimeSettings = {
      closeToTray: Boolean(settings.closeToTray),
      onboardingCompleted: Boolean(settings.onboardingCompleted),
      syncPaused: Boolean(settings.syncPaused),
      theme: settings.theme === "light" || settings.theme === "dark" ? settings.theme : "system",
      density: settings.density === "compact" ? "compact" : "comfortable",
      glassMode: settings.glassMode === "full" || settings.glassMode === "off" ? settings.glassMode : "auto"
    };
    if (!this.database) {
      this.memoryRuntimeSettings = normalized;
      return { ...normalized };
    }
    this.database.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run("runtime", JSON.stringify(normalized), new Date().toISOString());
    return normalized;
  }

  listCollections(): ProjectCollection[] {
    if (!this.database) return [...this.memoryCollections.values()].map((item) => ({ ...item, projectIds: [...item.projectIds] }));
    const rows = this.database.prepare(`
      SELECT c.id, c.name, c.color, c.created_at, c.updated_at,
             COALESCE(json_group_array(cp.project_id) FILTER (WHERE cp.project_id IS NOT NULL), '[]') AS project_ids
        FROM collections c LEFT JOIN collection_projects cp ON cp.collection_id = c.id
       GROUP BY c.id ORDER BY c.name COLLATE NOCASE
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), name: String(row.name), color: row.color ? String(row.color) : undefined,
      projectIds: parseStringArray(String(row.project_ids)), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    }));
  }

  createCollection(input: Pick<ProjectCollection, "name" | "color" | "projectIds">): ProjectCollection {
    const now = new Date().toISOString();
    const collection: ProjectCollection = {
      id: randomUUID(), name: input.name.trim(), color: input.color, projectIds: [...new Set(input.projectIds)],
      createdAt: now, updatedAt: now
    };
    if (!collection.name) throw new Error("集合名称不能为空。");
    if (!this.database) {
      this.memoryCollections.set(collection.id, collection);
      return { ...collection, projectIds: [...collection.projectIds] };
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO collections (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(collection.id, collection.name, collection.color ?? null, now, now);
      const insert = this.database.prepare("INSERT INTO collection_projects (collection_id, project_id, position) VALUES (?, ?, ?)");
      collection.projectIds.forEach((projectId, index) => insert.run(collection.id, projectId, index));
      this.database.exec("COMMIT");
      return collection;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  updateCollection(id: string, patch: Partial<Pick<ProjectCollection, "name" | "color" | "projectIds">>): ProjectCollection {
    const current = this.listCollections().find((item) => item.id === id);
    if (!current) throw new Error("集合不存在。");
    const updated: ProjectCollection = {
      ...current,
      name: patch.name?.trim() || current.name,
      color: Object.prototype.hasOwnProperty.call(patch, "color") ? patch.color : current.color,
      projectIds: patch.projectIds ? [...new Set(patch.projectIds)] : current.projectIds,
      updatedAt: new Date().toISOString()
    };
    if (!this.database) {
      this.memoryCollections.set(id, updated);
      return { ...updated, projectIds: [...updated.projectIds] };
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE collections SET name = ?, color = ?, updated_at = ? WHERE id = ?")
        .run(updated.name, updated.color ?? null, updated.updatedAt, id);
      if (patch.projectIds) {
        this.database.prepare("DELETE FROM collection_projects WHERE collection_id = ?").run(id);
        const insert = this.database.prepare("INSERT INTO collection_projects (collection_id, project_id, position) VALUES (?, ?, ?)");
        updated.projectIds.forEach((projectId, index) => insert.run(id, projectId, index));
      }
      this.database.exec("COMMIT");
      return updated;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  deleteCollection(id: string): void {
    if (!this.database) { this.memoryCollections.delete(id); return; }
    this.database.prepare("DELETE FROM collections WHERE id = ?").run(id);
  }

  listSmartViews(): SmartView[] {
    if (!this.database) return [...this.memorySmartViews.values()].map((item) => ({ ...item, filter: { ...item.filter, tags: item.filter.tags ? [...item.filter.tags] : undefined } }));
    return (this.database.prepare("SELECT id, name, filter, created_at, updated_at FROM smart_views ORDER BY name COLLATE NOCASE").all() as Array<Record<string, unknown>>)
      .map((row) => {
        let filter: SmartView["filter"] = {};
        try { filter = JSON.parse(String(row.filter)) as SmartView["filter"]; } catch { /* invalid legacy view stays empty */ }
        return { id: String(row.id), name: String(row.name), filter, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
      });
  }

  createSmartView(input: Pick<SmartView, "name" | "filter">): SmartView {
    const now = new Date().toISOString();
    const view: SmartView = { id: randomUUID(), name: input.name.trim(), filter: { ...input.filter }, createdAt: now, updatedAt: now };
    if (!view.name) throw new Error("智能视图名称不能为空。");
    if (!this.database) { this.memorySmartViews.set(view.id, view); return view; }
    this.database.prepare("INSERT INTO smart_views (id, name, filter, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(view.id, view.name, JSON.stringify(view.filter), now, now);
    return view;
  }

  updateSmartView(id: string, patch: Partial<Pick<SmartView, "name" | "filter">>): SmartView {
    const current = this.listSmartViews().find((item) => item.id === id);
    if (!current) throw new Error("智能视图不存在。");
    const updated: SmartView = {
      ...current, name: patch.name?.trim() || current.name, filter: patch.filter ? { ...patch.filter } : current.filter,
      updatedAt: new Date().toISOString()
    };
    if (!this.database) { this.memorySmartViews.set(id, updated); return updated; }
    this.database.prepare("UPDATE smart_views SET name = ?, filter = ?, updated_at = ? WHERE id = ?")
      .run(updated.name, JSON.stringify(updated.filter), updated.updatedAt, id);
    return updated;
  }

  deleteSmartView(id: string): void {
    if (!this.database) { this.memorySmartViews.delete(id); return; }
    this.database.prepare("DELETE FROM smart_views WHERE id = ?").run(id);
  }

  appendFileOperation(entry: ProjectFileOperationHistoryEntry): void {
    if (!this.database) return;
    this.database.prepare(`
      INSERT OR REPLACE INTO file_operation_history
        (id, project_id, operation, source_path, destination_path, created_at, undo_expires_at, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.projectId, entry.operation, entry.sourcePath, entry.destinationPath ?? null,
      entry.createdAt, entry.undoExpiresAt ?? null, entry.result);
  }

  fileOperationHistory(projectId: string, limit = 50): ProjectFileOperationHistoryEntry[] {
    if (!this.database) return [];
    return (this.database.prepare(`
      SELECT id, project_id, operation, source_path, destination_path, created_at, undo_expires_at, result
        FROM file_operation_history WHERE project_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(projectId, Math.max(1, Math.min(100, Math.trunc(limit)))) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), projectId: String(row.project_id), operation: row.operation as ProjectFileOperationHistoryEntry["operation"],
      sourcePath: String(row.source_path), destinationPath: row.destination_path ? String(row.destination_path) : undefined,
      createdAt: String(row.created_at), undoExpiresAt: row.undo_expires_at ? String(row.undo_expires_at) : undefined,
      result: row.result as ProjectFileOperationHistoryEntry["result"]
    }));
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }

  private require(projectId: string): ProjectSummary {
    const project = this.get(projectId);
    if (!project) throw new Error(`项目索引中不存在 ID: ${projectId}`);
    return project;
  }
}

export function createProjectCatalog(databasePath: string): ProjectCatalog {
  return new ProjectCatalog(databasePath);
}

export const CatalogService = ProjectCatalog;
