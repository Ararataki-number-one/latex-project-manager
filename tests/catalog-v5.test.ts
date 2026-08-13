import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogWriteUnavailableError, ProjectCatalog } from "../src/main/services/catalog";
import type { ProjectSummary } from "../src/shared/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function createProjectTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, target_count INTEGER NOT NULL DEFAULT 0,
      class_names TEXT NOT NULL DEFAULT '[]', last_opened_at TEXT, last_build_at TEXT, last_build_status TEXT,
      favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, trashed INTEGER NOT NULL DEFAULT 0,
      trashed_at TEXT, tags TEXT NOT NULL DEFAULT '[]', thumbnail_path TEXT, description TEXT NOT NULL DEFAULT '',
      lifecycle TEXT NOT NULL DEFAULT 'active', protection_state TEXT NOT NULL DEFAULT 'unprotected', updated_at TEXT NOT NULL
    );
  `);
}

function summary(rootPath: string): ProjectSummary {
  return {
    id: "project", name: "Project", rootPath, targetCount: 1, classNames: ["book"],
    favorite: false, archived: false, trashed: false, tags: [], pathAvailable: true,
    lifecycle: "active", protectionState: "unprotected"
  };
}

describe("catalog schema v5", () => {
  it("migrates v4 transactionally, normalizes lifecycle, and persists operation/status snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-v5-")); temporaryDirectories.push(root);
    const databasePath = join(root, "catalog.sqlite");
    const legacy = new DatabaseSync(databasePath);
    createProjectTable(legacy);
    legacy.prepare(`
      INSERT INTO projects (id, name, root_path, target_count, archived, lifecycle, updated_at)
      VALUES (?, ?, ?, 1, 1, 'paused', ?)
    `).run("project", "Project", root, new Date().toISOString());
    legacy.exec("PRAGMA user_version = 4");
    legacy.close();

    let catalog = new ProjectCatalog(databasePath);
    expect(catalog.status()).toMatchObject({
      schemaVersion: 5, databaseSchemaVersion: 5, mode: "readWrite", writable: true
    });
    expect(catalog.get("project")).toMatchObject({ lifecycle: "archived", archived: true });

    const now = new Date().toISOString();
    catalog.upsertOperationSnapshot({
      id: "operation", projectId: "project", kind: "sync", state: "running", title: "Sync",
      progress: 2, cancellable: true, retryable: false, createdAt: now, updatedAt: now
    });
    catalog.upsertProjectStatusSnapshot({
      projectId: "project", pathAvailable: true, storageBytes: 42, fileCount: 3,
      syncState: "synced", health: "attention", issues: ["warning", "warning"], capturedAt: now
    });
    catalog.close();

    catalog = new ProjectCatalog(databasePath);
    expect(catalog.operationSnapshots("project")).toMatchObject([
      { id: "operation", state: "running", progress: 1, cancellable: true }
    ]);
    expect(catalog.projectStatusSnapshot("project")).toMatchObject({
      projectId: "project", storageBytes: 42, issues: ["warning"]
    });
    expect(catalog.listBackups().some((backup) => backup.path.endsWith(".pre-v5.bak"))).toBe(true);

    expect(catalog.update("project", { lifecycle: "paused" })).toMatchObject({ lifecycle: "paused", archived: false });
    expect(catalog.update("project", { archived: true })).toMatchObject({ lifecycle: "archived", archived: true });
    expect(catalog.update("project", { archived: false })).toMatchObject({ lifecycle: "active", archived: false });
    catalog.close();
  });

  it("rolls back every project when an atomic project batch fails partway through", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-batch-")); temporaryDirectories.push(root);
    const databasePath = join(root, "catalog.sqlite");
    const catalog = new ProjectCatalog(databasePath);
    catalog.upsert(summary(root));

    const first = { ...summary(join(root, "first")), id: "first", name: "First" };
    const invalid = { ...summary(join(root, "invalid")), id: "invalid", name: undefined as never };
    expect(() => catalog.upsertManyAtomically([first, invalid])).toThrow();
    expect(catalog.list().map((project) => project.id)).toEqual(["project"]);
    expect(catalog.status()).toMatchObject({ writable: true, mode: "readWrite" });
    catalog.close();
  });

  it("fails closed after SQLite reports a full disk and rejects every later write", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-full-")); temporaryDirectories.push(root);
    const databasePath = join(root, "catalog.sqlite");
    const catalog = new ProjectCatalog(databasePath);
    catalog.upsert(summary(root));
    const injector = new DatabaseSync(databasePath);
    injector.exec(`
      CREATE TRIGGER simulate_disk_full BEFORE INSERT ON projects
      BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;
    `);
    injector.close();

    expect(() => catalog.upsert({ ...summary(join(root, "second")), id: "second" })).toThrow(/disk is full/i);
    expect(catalog.status()).toMatchObject({ persistent: true, writable: false, mode: "readOnly" });
    expect(catalog.status().readOnlyReason).toMatch(/disk is full/i);

    const cleanup = new DatabaseSync(databasePath);
    cleanup.exec("DROP TRIGGER simulate_disk_full");
    cleanup.close();
    expect(() => catalog.setRuntimeSettings({
      closeToTray: true, onboardingCompleted: false, syncPaused: false,
      theme: "system", density: "comfortable", glassMode: "auto"
    })).toThrow(CatalogWriteUnavailableError);
    expect(() => catalog.appendSyncEvent({
      id: "event", projectId: "project", occurredAt: new Date().toISOString(),
      state: "queued", level: "info", message: "queued"
    })).toThrow(CatalogWriteUnavailableError);
    catalog.close();
  });

  it.each([6, 99])("opens future schema v%s read-only without changing a database byte", async (version) => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-future-")); temporaryDirectories.push(root);
    const databasePath = join(root, `future-v${version}.sqlite`);
    const future = new DatabaseSync(databasePath);
    createProjectTable(future);
    future.prepare(`
      INSERT INTO projects (id, name, root_path, target_count, updated_at) VALUES (?, ?, ?, 1, ?)
    `).run("project", "Future", root, new Date().toISOString());
    future.exec(`CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('sentinel'); PRAGMA user_version = ${version}`);
    future.close();
    const before = readFileSync(databasePath);

    const catalog = new ProjectCatalog(databasePath);
    expect(catalog.status()).toMatchObject({
      schemaVersion: 5, databaseSchemaVersion: version, persistent: true, mode: "readOnly", writable: false
    });
    expect(catalog.list()).toMatchObject([{ id: "project", name: "Future" }]);
    // Future catalogs may not contain tables introduced by this client. Read
    // models must degrade to empty/default data while every write stays closed.
    expect(catalog.operationSnapshots()).toEqual([]);
    expect(catalog.projectStatusSnapshots()).toEqual([]);
    expect(catalog.projectStatusSnapshot("project")).toBeUndefined();
    expect(catalog.syncHistory("project")).toEqual([]);
    expect(catalog.listCollections()).toEqual([]);
    expect(catalog.listSmartViews()).toEqual([]);
    expect(catalog.researchWorks()).toEqual([]);
    expect(catalog.researchItems()).toEqual([]);
    expect(catalog.runtimeSettings()).toMatchObject({ theme: "system", density: "comfortable" });
    expect(() => catalog.upsert(summary(root))).toThrow(CatalogWriteUnavailableError);
    expect(() => catalog.appendSyncEvent({
      id: "event", projectId: "project", occurredAt: new Date().toISOString(),
      state: "queued", level: "info", message: "queued"
    })).toThrow(CatalogWriteUnavailableError);
    expect(() => catalog.setRuntimeSettings({
      closeToTray: true, onboardingCompleted: false, syncPaused: false,
      theme: "system", density: "comfortable", glassMode: "auto", editorExecutablePath: "C:\\Code.exe"
    })).toThrow(CatalogWriteUnavailableError);
    catalog.close();

    expect(readFileSync(databasePath).equals(before)).toBe(true);
    const verify = new DatabaseSync(databasePath, { readOnly: true });
    expect((verify.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(version);
    expect((verify.prepare("SELECT value FROM future_data").get() as { value: string }).value).toBe("sentinel");
    verify.close();
  });

  it("serves 500 cached project path states without probing their roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-cached-paths-")); temporaryDirectories.push(root);
    const catalog = new ProjectCatalog(join(root, "catalog.sqlite"));
    catalog.upsertManyAtomically(Array.from({ length: 500 }, (_, index) => ({
      ...summary(join(root, `intentionally-missing-${index}`)),
      id: `project-${index}`,
      name: `Project ${index}`,
      // The roots do not exist. Returning true proves list() uses the SQLite
      // cache rather than calling existsSync for each row.
      pathAvailable: true
    })));

    const listed = catalog.list();
    expect(listed).toHaveLength(500);
    expect(listed.every((project) => project.pathAvailable)).toBe(true);

    catalog.upsertProjectStatusSnapshot({
      projectId: "project-0", pathAvailable: false, health: "error",
      issues: ["path missing"], capturedAt: new Date().toISOString()
    });
    expect(catalog.get("project-0")?.pathAvailable).toBe(false);
    catalog.close();
  });

  it("opens a corrupt catalog as unavailable and never pretends a write succeeded", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-corrupt-")); temporaryDirectories.push(root);
    const databasePath = join(root, "corrupt.sqlite");
    await writeFile(databasePath, Buffer.from("not a sqlite database\0sentinel", "utf8"));
    const before = readFileSync(databasePath);

    const catalog = new ProjectCatalog(databasePath);
    expect(catalog.status()).toMatchObject({ persistent: false, mode: "unavailable", writable: false });
    expect(() => catalog.upsert(summary(root))).toThrow(CatalogWriteUnavailableError);
    catalog.close();
    expect(readFileSync(databasePath).equals(before)).toBe(true);
  });
});
