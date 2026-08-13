import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OperationCenter,
  OperationCenterError,
  type OperationCenterEvent
} from "../src/main/services/operation-center";
import { ProjectCatalog } from "../src/main/services/catalog";
import type { OperationSnapshot } from "../src/shared/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

class MemoryOperationCatalog {
  readonly snapshots = new Map<string, OperationSnapshot>();

  constructor(initial: OperationSnapshot[] = []) {
    for (const snapshot of initial) this.snapshots.set(snapshot.id, { ...snapshot });
  }

  operationSnapshots(projectId?: string, limit = 100): OperationSnapshot[] {
    return [...this.snapshots.values()]
      .filter((snapshot) => projectId === undefined || snapshot.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((snapshot) => ({ ...snapshot }));
  }

  upsertOperationSnapshot(snapshot: OperationSnapshot): OperationSnapshot {
    const persisted = { ...snapshot };
    this.snapshots.set(snapshot.id, persisted);
    return { ...persisted };
  }

  deleteOperationSnapshot(id: string): void {
    this.snapshots.delete(id);
  }
}

function sequenceClock(start = Date.UTC(2026, 7, 13)): () => Date {
  let tick = 0;
  return () => new Date(start + tick++ * 1_000);
}

function expectCode(action: () => unknown, code: OperationCenterError["code"]): void {
  try {
    action();
    throw new Error(`Expected OperationCenterError ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(OperationCenterError);
    expect((error as OperationCenterError).code).toBe(code);
  }
}

describe("OperationCenter", () => {
  it("persists snapshots and safely recovers interrupted work after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "operation-center-"));
    temporaryDirectories.push(root);
    const databasePath = join(root, "library.sqlite");

    let catalog = new ProjectCatalog(databasePath);
    let center = new OperationCenter(catalog, { now: sequenceClock(), createId: () => "unused" });
    center.start({ id: "interrupted", kind: "backup", title: "创建快照", message: "正在打包" });
    center.update("interrupted", { state: "running", progress: 0.4 });
    center.start({ id: "finished", kind: "index", title: "更新索引" });
    center.complete("finished", "索引已更新");
    center.start({ id: "queued", kind: "export", title: "等待导出" });
    center.dispose();
    catalog.close();

    catalog = new ProjectCatalog(databasePath);
    center = new OperationCenter(catalog, { now: () => new Date("2026-08-14T00:00:00.000Z") });
    expect(center.list().map(({ id }) => id)).toEqual(["queued", "interrupted", "finished"]);
    expect(center.list().find(({ id }) => id === "interrupted")).toMatchObject({
      state: "failed",
      progress: 0.4,
      cancellable: false,
      retryable: false,
      completedAt: "2026-08-14T00:00:00.000Z"
    });
    expect(center.list().find(({ id }) => id === "interrupted")?.message).toContain("请重试");
    expect(center.list().find(({ id }) => id === "queued")).toMatchObject({
      state: "failed",
      retryable: false,
      completedAt: "2026-08-14T00:00:00.000Z"
    });
    expect(center.list().find(({ id }) => id === "finished")).toMatchObject({
      state: "succeeded",
      progress: 1,
      message: "索引已更新"
    });
    center.dispose();
    catalog.close();

    catalog = new ProjectCatalog(databasePath);
    center = new OperationCenter(catalog, { now: () => new Date("2026-08-15T00:00:00.000Z") });
    expect(center.list().find(({ id }) => id === "interrupted")?.updatedAt).toBe("2026-08-14T00:00:00.000Z");
    center.dispose();
    catalog.close();
  });

  it("enforces bounded monotonic progress and immutable terminal states", () => {
    const catalog = new MemoryOperationCatalog();
    const center = new OperationCenter(catalog, { now: sequenceClock(), createId: () => "generated" });

    expect(center.start({ kind: "sync", title: "同步项目", progress: 0.1 })).toMatchObject({
      id: "generated",
      state: "queued",
      progress: 0.1
    });
    center.update("generated", { progress: 0.25 });
    center.update("generated", { state: "running", progress: 0.5 });
    expectCode(() => center.update("generated", { progress: 0.49 }), "NON_MONOTONIC_PROGRESS");
    expectCode(() => center.update("generated", { progress: 1.01 }), "INVALID_PROGRESS");
    expectCode(() => center.update("generated", { progress: Number.NaN }), "INVALID_PROGRESS");
    expectCode(() => center.update("generated", { state: "queued" }), "INVALID_TRANSITION");

    expect(center.complete("generated", "同步完成")).toMatchObject({
      state: "succeeded",
      progress: 1,
      cancellable: false,
      retryable: false,
      message: "同步完成"
    });
    expectCode(() => center.update("generated", { message: "late write" }), "TERMINAL_OPERATION");
    expectCode(() => center.retry("generated"), "NOT_RETRYABLE");
  });

  it("publishes isolated lifecycle events and supports unsubscribe and dispose", () => {
    const catalog = new MemoryOperationCatalog();
    const center = new OperationCenter(catalog, { now: sequenceClock() });
    const events: OperationCenterEvent[] = [];
    const unsubscribe = center.subscribe((event) => {
      events.push(event);
      event.snapshot.title = "listener mutation";
    });

    center.start({ id: "export-one", kind: "export", title: "导出项目" });
    center.update("export-one", { state: "running", progress: 0.3 });
    center.fail("export-one", "网络不可用", {
      failureCode: "NETWORK",
      recoveryAction: "联网后重试"
    });
    expect(center.retry("export-one")).toMatchObject({ state: "queued", progress: 0 });

    expect(events.map(({ type }) => type)).toEqual(["started", "updated", "failed", "retried"]);
    expect(events[2].snapshot).toMatchObject({
      message: "网络不可用",
      failureCode: "NETWORK",
      recoveryAction: "联网后重试"
    });
    expect(center.list()[0].title).toBe("导出项目");

    unsubscribe();
    center.update("export-one", { state: "running", progress: 0.2 });
    expect(events).toHaveLength(4);
    center.dispose();
    expectCode(() => center.start({ kind: "cleanup", title: "清理" }), "DISPOSED");
  });

  it("handles blocked, failed and cancelled operations with explicit retry rules", () => {
    const center = new OperationCenter(new MemoryOperationCatalog(), { now: sequenceClock() });

    center.start({ id: "blocked", kind: "sync", title: "推送", cancellable: true });
    expect(center.block("blocked", "检测到分支分叉")).toMatchObject({
      state: "blocked",
      retryable: true,
      cancellable: false
    });
    expect(center.retry("blocked")).toMatchObject({ state: "queued", progress: 0 });

    center.start({ id: "failed", kind: "backup", title: "备份" });
    expect(center.fail("failed", "空间不足", { retryable: false })).toMatchObject({
      state: "failed",
      retryable: false
    });
    expectCode(() => center.retry("failed"), "NOT_RETRYABLE");

    center.start({ id: "fixed", kind: "migration", title: "迁移", cancellable: false });
    expectCode(() => center.cancel("fixed"), "NOT_CANCELLABLE");
    center.update("fixed", { cancellable: true });
    expect(center.cancel("fixed")).toMatchObject({ state: "cancelled", cancellable: false });
    expect(center.retry("fixed")).toMatchObject({ state: "queued", progress: 0 });
  });

  it("does not report renderer cancel or retry success without a real worker controller", async () => {
    const center = new OperationCenter(new MemoryOperationCatalog(), { now: sequenceClock() });
    center.start({ id: "download", kind: "update", title: "Download update", state: "running" });
    await expect(center.requestCancel("download")).rejects.toMatchObject({ code: "CONTROL_UNAVAILABLE" });
    expect(center.list().find(({ id }) => id === "download")?.state).toBe("running");

    center.fail("download", "network offline");
    await expect(center.requestRetry("download")).rejects.toMatchObject({ code: "CONTROL_UNAVAILABLE" });
    expect(center.list().find(({ id }) => id === "download")?.state).toBe("failed");
  });

  it("routes renderer controls to the worker and only then updates durable state", async () => {
    const center = new OperationCenter(new MemoryOperationCatalog(), { now: sequenceClock() });
    center.start({ id: "update", kind: "update", title: "Download update", state: "running" });
    let cancelled = false;
    let retried = false;
    center.registerController("update", {
      cancel: () => { cancelled = true; },
      retry: async () => { retried = true; }
    });

    await expect(center.requestCancel("update")).resolves.toMatchObject({ state: "cancelled" });
    expect(cancelled).toBe(true);
    await expect(center.requestRetry("update")).resolves.toMatchObject({ state: "succeeded" });
    expect(retried).toBe(true);
  });
});
