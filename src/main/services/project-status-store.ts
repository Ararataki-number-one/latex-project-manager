import type {
  GitHubSyncEvent,
  ProjectStatusChangedEvent,
  ProjectStatusFreshness,
  ProjectStatusRecord,
  ProjectStatusSnapshot,
  ProjectSummary
} from "../../shared/types";
import type { ProjectCatalog } from "./catalog";

export type { ProjectStatusChangedEvent, ProjectStatusFreshness, ProjectStatusRecord } from "../../shared/types";

export type ProjectStatusProbeResult = Omit<ProjectStatusSnapshot, "projectId" | "capturedAt"> & {
  capturedAt?: string;
};

export type ProjectStatusProbe = (
  project: ProjectSummary,
  previous: ProjectStatusSnapshot | undefined
) => Promise<ProjectStatusProbeResult>;

export interface ProjectStatusStoreOptions {
  probe?: ProjectStatusProbe;
  now?: () => Date;
}

export type ProjectStatusListener = (event: ProjectStatusChangedEvent) => void;

type StatusCatalog = Pick<ProjectCatalog, "projectStatusSnapshots" | "upsertProjectStatusSnapshot">;

const REFRESH_FAILURE_PREFIX = "状态刷新失败：";
const SYNC_ISSUE_PREFIX = "GitHub 同步：";

export class ProjectStatusStoreDisposedError extends Error {
  constructor() {
    super("Project status store has been disposed.");
    this.name = "ProjectStatusStoreDisposedError";
  }
}

/**
 * Owns the main-process view of cached project status.
 *
 * Construction reads SQLite only. No project root is touched until `refresh`
 * is explicitly requested, which keeps a large project library's first paint
 * independent from filesystem and Git latency.
 */
export class ProjectStatusStore {
  private readonly records = new Map<string, ProjectStatusRecord>();
  private readonly inFlight = new Map<string, Promise<ProjectStatusRecord>>();
  private readonly listeners = new Set<ProjectStatusListener>();
  private readonly now: () => Date;
  private disposed = false;

  constructor(
    private readonly catalog: StatusCatalog,
    private readonly options: ProjectStatusStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    for (const snapshot of catalog.projectStatusSnapshots()) {
      this.records.set(snapshot.projectId, {
        snapshot: cloneSnapshot(snapshot),
        freshness: "cached"
      });
    }
  }

  list(): ProjectStatusRecord[] {
    return [...this.records.values()]
      .sort((left, right) => right.snapshot.capturedAt.localeCompare(left.snapshot.capturedAt))
      .map(cloneRecord);
  }

  get(projectId: string): ProjectStatusRecord | undefined {
    const record = this.records.get(projectId);
    return record ? cloneRecord(record) : undefined;
  }

  /** Applies the authoritative GitHub event without probing the project root. */
  applySyncEvent(event: GitHubSyncEvent, pathAvailable = true): ProjectStatusRecord {
    this.assertActive();
    const previous = this.records.get(event.projectId)?.snapshot;
    const issues = normalizeIssues((previous?.issues ?? [])
      .filter((issue) => !issue.startsWith(SYNC_ISSUE_PREFIX)));
    if (["blocked", "error", "needsPull", "unavailable"].includes(event.state)) {
      issues.push(`${SYNC_ISSUE_PREFIX}${event.message}`);
    }
    const snapshot: ProjectStatusSnapshot = {
      ...(previous ? cloneSnapshot(previous) : {
        projectId: event.projectId,
        pathAvailable,
        health: "healthy" as const,
        issues: []
      }),
      syncState: event.state,
      syncMessage: event.message,
      health: ["blocked", "error", "needsPull", "unavailable"].includes(event.state)
        ? "error"
        : deriveHealth(issues),
      issues: normalizeIssues(issues),
      capturedAt: event.occurredAt || this.now().toISOString()
    };
    const persisted = this.catalog.upsertProjectStatusSnapshot(snapshot);
    const record: ProjectStatusRecord = { snapshot: cloneSnapshot(persisted), freshness: "fresh" };
    this.records.set(event.projectId, record);
    this.emit(record);
    return cloneRecord(record);
  }

  /** Refreshes exactly one project. Concurrent calls for the same id are deduplicated. */
  refresh(project: ProjectSummary): Promise<ProjectStatusRecord> {
    this.assertActive();
    const existing = this.inFlight.get(project.id);
    if (existing) return existing;

    const operation = this.performRefresh(project).finally(() => {
      if (this.inFlight.get(project.id) === operation) this.inFlight.delete(project.id);
    });
    this.inFlight.set(project.id, operation);
    return operation;
  }

  subscribe(listener: ProjectStatusListener): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.inFlight.clear();
  }

  private async performRefresh(project: ProjectSummary): Promise<ProjectStatusRecord> {
    const previous = this.records.get(project.id)?.snapshot;
    try {
      if (!this.options.probe) throw new Error("No project status probe is configured.");
      const probed = await this.options.probe(project, previous ? cloneSnapshot(previous) : undefined);
      this.assertActive();

      const snapshot: ProjectStatusSnapshot = {
        ...probed,
        projectId: project.id,
        issues: normalizeIssues(probed.issues).filter((issue) => !issue.startsWith(REFRESH_FAILURE_PREFIX)),
        capturedAt: probed.capturedAt ?? this.now().toISOString()
      };
      const persisted = this.catalog.upsertProjectStatusSnapshot(snapshot);
      const record: ProjectStatusRecord = {
        snapshot: cloneSnapshot(persisted),
        freshness: "fresh"
      };
      this.records.set(project.id, record);
      this.emit(record);
      return cloneRecord(record);
    } catch (error) {
      if (this.disposed || error instanceof ProjectStatusStoreDisposedError) throw error;

      const message = errorMessage(error);
      const staleSnapshot: ProjectStatusSnapshot = previous
        ? {
            ...cloneSnapshot(previous),
            health: previous.health === "error" ? "error" : "attention",
            issues: normalizeIssues([
              ...previous.issues.filter((issue) => !issue.startsWith(REFRESH_FAILURE_PREFIX)),
              `${REFRESH_FAILURE_PREFIX}${message}`
            ])
          }
        : {
            projectId: project.id,
            pathAvailable: project.pathAvailable,
            health: "error",
            issues: [`${REFRESH_FAILURE_PREFIX}${message}`],
            capturedAt: this.now().toISOString()
          };

      // Persist the diagnostic while retaining the last observation timestamp and
      // all last-known-good measurements. If persistence itself fails, the runtime
      // record remains useful and reports both failures.
      let stored = staleSnapshot;
      let refreshError = message;
      try {
        stored = this.catalog.upsertProjectStatusSnapshot(staleSnapshot);
      } catch (persistenceError) {
        const persistenceMessage = errorMessage(persistenceError);
        refreshError = `${message}；缓存保存失败：${persistenceMessage}`;
        stored = {
          ...staleSnapshot,
          issues: normalizeIssues([
            ...staleSnapshot.issues,
            `状态缓存保存失败：${persistenceMessage}`
          ])
        };
      }

      const record: ProjectStatusRecord = {
        snapshot: cloneSnapshot(stored),
        freshness: "stale",
        refreshError
      };
      this.records.set(project.id, record);
      this.emit(record);
      return cloneRecord(record);
    }
  }

  private emit(record: ProjectStatusRecord): void {
    const event: ProjectStatusChangedEvent = {
      type: "changed",
      projectId: record.snapshot.projectId,
      record: cloneRecord(record)
    };
    for (const listener of this.listeners) listener(event);
  }

  private assertActive(): void {
    if (this.disposed) throw new ProjectStatusStoreDisposedError();
  }
}

function cloneSnapshot(snapshot: ProjectStatusSnapshot): ProjectStatusSnapshot {
  return { ...snapshot, issues: [...snapshot.issues] };
}

function cloneRecord(record: ProjectStatusRecord): ProjectStatusRecord {
  return {
    ...record,
    snapshot: cloneSnapshot(record.snapshot)
  };
}

function normalizeIssues(issues: readonly string[]): string[] {
  return [...new Set(issues.map((issue) => issue.trim()).filter(Boolean))];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "未知错误";
}

function deriveHealth(issues: readonly string[]): ProjectStatusSnapshot["health"] {
  if (issues.some((issue) => /失败|失效|阻止|冲突|error|blocked/i.test(issue))) return "error";
  return issues.length > 0 ? "attention" : "healthy";
}
