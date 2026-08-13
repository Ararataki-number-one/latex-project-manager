import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { WorkbenchApi } from "@/shared/ipc";
import type { GitHubSyncStatus, ProjectSummary } from "@/shared/types";

type StatusSnapshot = Readonly<Record<string, GitHubSyncStatus>>;

class ProjectGitHubStatusStore {
  private snapshot: StatusSnapshot = {};
  private readonly listeners = new Set<() => void>();
  private readonly consumers = new Map<symbol, Set<string>>();
  private readonly active = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly api: WorkbenchApi) {}

  getSnapshot = (): StatusSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  register(token: symbol, projectIds: readonly string[]): void {
    this.consumers.set(token, new Set(projectIds));
    void this.refresh(projectIds);
  }

  unregister(token: symbol): void {
    this.consumers.delete(token);
  }

  async refresh(projectIds: readonly string[] = this.projectIds()): Promise<void> {
    const queue = [...new Set(projectIds)].filter(Boolean);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queue.length) {
        const projectId = queue[cursor++];
        await this.refreshOne(projectId);
      }
    };
    await Promise.all([worker(), worker()]);
  }

  private async refreshOne(projectId: string): Promise<void> {
    const existing = this.active.get(projectId);
    if (existing) return existing;
    const task = this.api.github.status(projectId)
      .then((status) => {
        if (this.snapshot[projectId] === status) return;
        this.snapshot = { ...this.snapshot, [projectId]: status };
        for (const listener of this.listeners) listener();
      })
      .catch(() => undefined)
      .finally(() => { this.active.delete(projectId); });
    this.active.set(projectId, task);
    return task;
  }

  private start(): void {
    this.unsubscribe ??= this.api.github.onEvent((event) => {
      if (this.projectIds().includes(event.projectId)) void this.refreshOne(event.projectId);
    });
    const tick = async (): Promise<void> => {
      await this.refresh();
      if (this.listeners.size > 0) this.timer = setTimeout(() => { void tick(); }, 60_000);
    };
    void tick();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private projectIds(): string[] {
    return [...new Set([...this.consumers.values()].flatMap((ids) => [...ids]))];
  }
}

const stores = new WeakMap<WorkbenchApi, ProjectGitHubStatusStore>();

function storeFor(api: WorkbenchApi): ProjectGitHubStatusStore {
  let store = stores.get(api);
  if (!store) {
    store = new ProjectGitHubStatusStore(api);
    stores.set(api, store);
  }
  return store;
}

export function useProjectGitHubStatuses(api: WorkbenchApi, projects: readonly ProjectSummary[]): {
  statuses: StatusSnapshot;
  refresh: () => Promise<void>;
} {
  const store = storeFor(api);
  const token = useMemo(() => Symbol("github-status-consumer"), []);
  const projectIds = useMemo(
    () => projects.filter((project) => project.pathAvailable && !project.trashed).map((project) => project.id),
    [projects]
  );
  const signature = projectIds.join("\0");
  useEffect(() => {
    store.register(token, projectIds);
    return () => store.unregister(token);
  }, [signature, store, token]);
  return {
    statuses: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot),
    refresh: () => store.refresh(projectIds)
  };
}
