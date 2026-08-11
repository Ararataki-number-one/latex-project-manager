import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AppRuntimeSettings,
  BuildStatus,
  GitHubSyncEvent,
  ProjectManifest,
  ProjectSummary
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
  syncPaused: false
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
    pathAvailable: existsSync(rootPath)
  };
}

export class ProjectCatalog {
  private readonly memory = new Map<string, ProjectSummary>();
  private readonly memorySyncEvents = new Map<string, GitHubSyncEvent[]>();
  private memoryRuntimeSettings: AppRuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  private database: DatabaseSync | null = null;
  readonly fallbackReason?: string;

  constructor(public readonly databasePath: string) {
    let fallbackReason: string | undefined;
    try {
      mkdirSync(dirname(databasePath), { recursive: true });
      this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
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
          message TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sync_events_project_time ON sync_events(project_id, occurred_at DESC);
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const columns = new Set(
        (this.database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((column) => column.name)
      );
      if (!columns.has("trashed")) {
        this.database.exec("ALTER TABLE projects ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0");
      }
      if (!columns.has("trashed_at")) {
        this.database.exec("ALTER TABLE projects ADD COLUMN trashed_at TEXT");
      }
      this.database.exec("PRAGMA user_version = 2");
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

  list(): ProjectSummary[] {
    if (!this.database) {
      return [...this.memory.values()]
        .map(cloneSummary)
        .sort((left, right) => (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? ""));
    }
    const rows = this.database
      .prepare(
        `SELECT id, name, root_path, target_count, class_names, last_opened_at, last_build_at,
                last_build_status, favorite, archived, trashed, trashed_at, tags, thumbnail_path
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
                last_build_status, favorite, archived, trashed, trashed_at, tags, thumbnail_path
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
           last_build_status, favorite, archived, trashed, trashed_at, tags, thumbnail_path, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    patch: Partial<Pick<ProjectSummary, "name" | "favorite" | "archived" | "trashed" | "tags">>
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
        syncPaused: typeof parsed.syncPaused === "boolean" ? parsed.syncPaused : false
      };
    } catch {
      return { ...DEFAULT_RUNTIME_SETTINGS };
    }
  }

  setRuntimeSettings(settings: AppRuntimeSettings): AppRuntimeSettings {
    const normalized: AppRuntimeSettings = {
      closeToTray: Boolean(settings.closeToTray),
      onboardingCompleted: Boolean(settings.onboardingCompleted),
      syncPaused: Boolean(settings.syncPaused)
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
