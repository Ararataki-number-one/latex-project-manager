import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { ProjectCatalog } from "../src/main/services/catalog";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("project catalog application trash", () => {
  it("migrates an existing database and persists reversible trash metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-workbench-catalog-trash-"));
    temporaryDirectories.push(root);
    const databasePath = join(root, "library.sqlite");
    const oldDatabase = new DatabaseSync(databasePath);
    oldDatabase.exec(`
      CREATE TABLE projects (
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
        tags TEXT NOT NULL DEFAULT '[]',
        thumbnail_path TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects (
        id, name, root_path, target_count, class_names, favorite, archived, tags, updated_at
      ) VALUES ('legacy-project', 'Legacy', '${root.replaceAll("'", "''")}', 1, '["book"]', 0, 0, '[]', '2026-01-01T00:00:00.000Z');
    `);
    oldDatabase.close();

    const catalog = new ProjectCatalog(databasePath);
    expect(catalog.persistent).toBe(true);
    expect(catalog.get("legacy-project")).toMatchObject({ trashed: false, trashedAt: undefined });
    const trashed = catalog.update("legacy-project", { trashed: true });
    expect(trashed.trashed).toBe(true);
    expect(trashed.trashedAt).toBeTruthy();
    catalog.close();

    const reopened = new ProjectCatalog(databasePath);
    expect(reopened.get("legacy-project")).toMatchObject({ trashed: true, trashedAt: trashed.trashedAt });
    expect(reopened.update("legacy-project", { trashed: false })).toMatchObject({ trashed: false, trashedAt: undefined });
    reopened.close();
  });
});
