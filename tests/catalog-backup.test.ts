import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectCatalog } from "../src/main/services/catalog";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("catalog schema v5 backup and staged restore", () => {
  it("validates a manual backup and restores it only on the next catalog start", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-backup-")); temporaryDirectories.push(root);
    const database = join(root, "library.sqlite"); const backup = join(root, "manual.sqlite");
    let catalog = new ProjectCatalog(database);
    expect(catalog.status()).toMatchObject({ schemaVersion: 5, writable: true, mode: "readWrite" });
    catalog.upsert({ id: "project", name: "Before", rootPath: root, targetCount: 1, classNames: ["book"],
      favorite: false, archived: false, trashed: false, tags: [], pathAvailable: true });
    expect(catalog.backupTo(backup)).toMatchObject({ path: backup, kind: "manual" });
    catalog.update("project", { name: "After" });
    expect(catalog.stageRestore(backup)).toMatchObject({ path: backup });
    expect(catalog.get("project")?.name).toBe("After");
    catalog.close();

    catalog = new ProjectCatalog(database);
    expect(catalog.get("project")?.name).toBe("Before");
    expect(catalog.listBackups().some((entry) => entry.path.endsWith(".before-restore.bak"))).toBe(true);
    catalog.close();
  });
});
