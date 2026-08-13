import { describe, expect, it, vi } from "vitest";

import {
  ProjectStatusStore,
  ProjectStatusStoreDisposedError,
  type ProjectStatusProbe
} from "../src/main/services/project-status-store";
import type { ProjectCatalog } from "../src/main/services/catalog";
import type { ProjectStatusSnapshot, ProjectSummary } from "../src/shared/types";

type StatusCatalog = Pick<ProjectCatalog, "projectStatusSnapshots" | "upsertProjectStatusSnapshot">;

const project: ProjectSummary = {
  id: "project-1",
  name: "Probability Notes",
  rootPath: "C:/notes/probability",
  targetCount: 1,
  classNames: ["elegantbook"],
  favorite: false,
  archived: false,
  trashed: false,
  tags: [],
  pathAvailable: true
};

const cachedSnapshot: ProjectStatusSnapshot = {
  projectId: project.id,
  pathAvailable: true,
  storageBytes: 42,
  fileCount: 3,
  mainPdfPath: "main.pdf",
  mainPdfSize: 20,
  researchCount: 2,
  syncState: "synced",
  health: "healthy",
  issues: [],
  capturedAt: "2026-08-12T00:00:00.000Z"
};

function fakeCatalog(initial: ProjectStatusSnapshot[] = [cachedSnapshot]): StatusCatalog & {
  projectStatusSnapshots: ReturnType<typeof vi.fn>;
  upsertProjectStatusSnapshot: ReturnType<typeof vi.fn>;
} {
  return {
    projectStatusSnapshots: vi.fn(() => initial.map(cloneSnapshot)),
    upsertProjectStatusSnapshot: vi.fn((snapshot: ProjectStatusSnapshot) => cloneSnapshot(snapshot))
  };
}

describe("ProjectStatusStore", () => {
  it("loads list/get from the catalog cache without invoking the probe", () => {
    const catalog = fakeCatalog();
    const probe = vi.fn<ProjectStatusProbe>();
    const store = new ProjectStatusStore(catalog, { probe });

    expect(store.list()).toEqual([{ snapshot: cachedSnapshot, freshness: "cached" }]);
    expect(store.get(project.id)).toEqual({ snapshot: cachedSnapshot, freshness: "cached" });
    expect(probe).not.toHaveBeenCalled();
    expect(catalog.projectStatusSnapshots).toHaveBeenCalledTimes(1);
    expect(catalog.upsertProjectStatusSnapshot).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent refreshes for one project", async () => {
    const catalog = fakeCatalog();
    let finish: ((value: Awaited<ReturnType<ProjectStatusProbe>>) => void) | undefined;
    const probe = vi.fn<ProjectStatusProbe>(() => new Promise((resolve) => { finish = resolve; }));
    const store = new ProjectStatusStore(catalog, {
      probe,
      now: () => new Date("2026-08-13T08:00:00.000Z")
    });

    const first = store.refresh(project);
    const second = store.refresh(project);
    expect(first).toBe(second);
    expect(probe).toHaveBeenCalledTimes(1);

    finish?.({
      pathAvailable: true,
      storageBytes: 100,
      fileCount: 8,
      health: "healthy",
      issues: []
    });

    await expect(first).resolves.toMatchObject({
      freshness: "fresh",
      snapshot: { storageBytes: 100, capturedAt: "2026-08-13T08:00:00.000Z" }
    });
    await expect(second).resolves.toMatchObject({ freshness: "fresh" });
    expect(catalog.upsertProjectStatusSnapshot).toHaveBeenCalledTimes(1);
  });

  it("publishes immutable changed events and supports unsubscribe", async () => {
    const catalog = fakeCatalog();
    const probe = vi.fn<ProjectStatusProbe>().mockResolvedValue({
      pathAvailable: true,
      storageBytes: 80,
      health: "attention",
      issues: ["未设置主 PDF"]
    });
    const store = new ProjectStatusStore(catalog, { probe });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.refresh(project);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      type: "changed",
      projectId: project.id,
      record: { freshness: "fresh", snapshot: { issues: ["未设置主 PDF"] } }
    });

    listener.mock.calls[0]?.[0].record.snapshot.issues.push("mutated by listener");
    expect(store.get(project.id)?.snapshot.issues).toEqual(["未设置主 PDF"]);
    unsubscribe();
    await store.refresh(project);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps last-known-good measurements when refresh fails and marks the record stale", async () => {
    const catalog = fakeCatalog();
    const probe = vi.fn<ProjectStatusProbe>().mockRejectedValue(new Error("project drive is offline"));
    const store = new ProjectStatusStore(catalog, { probe });

    const record = await store.refresh(project);

    expect(record).toMatchObject({
      freshness: "stale",
      refreshError: "project drive is offline",
      snapshot: {
        projectId: project.id,
        storageBytes: 42,
        fileCount: 3,
        mainPdfPath: "main.pdf",
        capturedAt: cachedSnapshot.capturedAt,
        health: "attention"
      }
    });
    expect(record.snapshot.issues).toEqual(["状态刷新失败：project drive is offline"]);
    expect(catalog.upsertProjectStatusSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      storageBytes: 42,
      capturedAt: cachedSnapshot.capturedAt,
      issues: ["状态刷新失败：project drive is offline"]
    }));
  });

  it("stops accepting work and emitting after dispose", async () => {
    const catalog = fakeCatalog();
    let finish: ((value: Awaited<ReturnType<ProjectStatusProbe>>) => void) | undefined;
    const probe = vi.fn<ProjectStatusProbe>(() => new Promise((resolve) => { finish = resolve; }));
    const store = new ProjectStatusStore(catalog, { probe });
    const listener = vi.fn();
    store.subscribe(listener);
    const pending = store.refresh(project);

    store.dispose();
    finish?.({ pathAvailable: true, health: "healthy", issues: [] });

    await expect(pending).rejects.toBeInstanceOf(ProjectStatusStoreDisposedError);
    expect(listener).not.toHaveBeenCalled();
    expect(catalog.upsertProjectStatusSnapshot).not.toHaveBeenCalled();
    expect(() => store.refresh(project)).toThrow(ProjectStatusStoreDisposedError);
  });

  it("applies GitHub events immediately from the shared status source without probing disk", () => {
    const catalog = fakeCatalog();
    const probe = vi.fn<ProjectStatusProbe>();
    const store = new ProjectStatusStore(catalog, { probe });
    const listener = vi.fn();
    store.subscribe(listener);

    const blocked = store.applySyncEvent({
      id: "event-1",
      projectId: project.id,
      occurredAt: "2026-08-13T09:00:00.000Z",
      state: "blocked",
      level: "error",
      message: "检测到风险文件"
    });
    expect(blocked).toMatchObject({
      freshness: "fresh",
      snapshot: {
        syncState: "blocked",
        syncMessage: "检测到风险文件",
        health: "error",
        issues: ["GitHub 同步：检测到风险文件"]
      }
    });
    expect(probe).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);

    expect(store.applySyncEvent({
      id: "event-2",
      projectId: project.id,
      occurredAt: "2026-08-13T09:01:00.000Z",
      state: "synced",
      level: "info",
      message: "同步完成"
    }).snapshot).toMatchObject({ syncState: "synced", health: "healthy", issues: [] });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

function cloneSnapshot(snapshot: ProjectStatusSnapshot): ProjectStatusSnapshot {
  return { ...snapshot, issues: [...snapshot.issues] };
}
