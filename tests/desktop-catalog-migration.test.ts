import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectCatalog } from "../src/main/services/catalog";
import {
  applyDesktopCatalogMigration,
  canonicalProjectRoot,
  previewDesktopCatalogMigration
} from "../src/main/services/desktop-catalog-migration";
import type { CatalogProjectResearchItem, ProjectSummary, ResearchWork } from "../src/shared/types";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function project(
  id: string,
  name: string,
  rootPath: string,
  patch: Partial<ProjectSummary> = {}
): ProjectSummary {
  return {
    id, name, rootPath, targetCount: 1, classNames: ["book"], favorite: false,
    archived: false, trashed: false, tags: [], pathAvailable: true,
    description: "", lifecycle: "active", protectionState: "unprotected", ...patch
  };
}

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

describe("desktop catalog migration", () => {
  it("previews stable and beta sources, deduplicates canonical roots, backs up, and applies explicit resolutions", async () => {
    const root = await makeRoot("latex-desktop-migration-");
    const sharedRoot = join(root, "shared-project");
    const conflictRoot = join(root, "conflict-project");
    const betaRoot = join(root, "beta-project");
    await Promise.all([mkdir(sharedRoot), mkdir(conflictRoot), mkdir(betaRoot)]);

    const targetPath = join(root, "target.sqlite");
    const stablePath = join(root, "stable-0111.sqlite");
    const betaPath = join(root, "beta.sqlite");
    const target = new ProjectCatalog(targetPath);
    target.upsert(project("shared", "Shared", sharedRoot, { tags: ["target"] }));
    target.upsert(project("target-conflict", "Keep me", conflictRoot, { favorite: true }));

    const stable = new ProjectCatalog(stablePath);
    stable.upsert(project("shared", "Older shared", join(sharedRoot, "."), {
      tags: ["stable"], favorite: true, description: "Imported description", lifecycle: "paused"
    }));
    stable.upsert(project("source-conflict", "Source conflict", conflictRoot, { tags: ["source"] }));
    stable.close();
    const stable0111 = new DatabaseSync(stablePath);
    stable0111.exec("PRAGMA user_version = 4");
    stable0111.close();

    const beta = new ProjectCatalog(betaPath);
    beta.upsert(project("beta-only", "Beta only", betaRoot, { protectionState: "github" }));
    beta.close();
    const stableBefore = readFileSync(stablePath);
    const betaBefore = readFileSync(betaPath);

    const preview = previewDesktopCatalogMigration(target, [
      { kind: "stable0111", databasePath: stablePath, label: "0.11.1" },
      { kind: "beta", databasePath: betaPath, label: "1.0 Beta" }
    ]);
    expect(preview.sources).toMatchObject([
      { kind: "stable0111", schemaVersion: 4 }, { kind: "beta", schemaVersion: 5 }
    ]);
    expect(preview.projects.map((item) => item.action)).toEqual(["merge", "conflict", "import"]);
    expect(preview.conflicts).toMatchObject([{ kind: "sameRootDifferentProject" }]);
    expect(preview.projects[0].canonicalRoot).toBe(canonicalProjectRoot(sharedRoot));
    expect(preview.warnings.join("\n")).toContain("files outside the catalog database remain untouched");
    expect(() => applyDesktopCatalogMigration(target, preview, { resolutions: {} })).toThrow(/explicit resolution/i);

    const result = applyDesktopCatalogMigration(target, preview, {
      resolutions: { [preview.conflicts[0].id]: "keepTarget" }
    });
    expect(result).toMatchObject({ imported: 1, merged: 1, skipped: 1 });
    expect(existsSync(result.backupPath)).toBe(true);
    expect(target.get("shared")).toMatchObject({
      name: "Shared", tags: ["target", "stable"], favorite: true,
      description: "Imported description", lifecycle: "paused", archived: false
    });
    expect(target.get("target-conflict")).toMatchObject({ name: "Keep me", favorite: true });
    expect(target.get("source-conflict")).toBeUndefined();
    expect(target.get("beta-only")).toMatchObject({ name: "Beta only", protectionState: "github" });
    expect(readFileSync(stablePath).equals(stableBefore)).toBe(true);
    expect(readFileSync(betaPath).equals(betaBefore)).toBe(true);
    target.close();
  });

  it("refuses a stale preview and leaves the target unchanged", async () => {
    const root = await makeRoot("latex-desktop-migration-stale-");
    const sourceProjectRoot = join(root, "source-project");
    await mkdir(sourceProjectRoot);
    const targetPath = join(root, "target.sqlite");
    const sourcePath = join(root, "source.sqlite");
    const target = new ProjectCatalog(targetPath);
    const source = new ProjectCatalog(sourcePath);
    source.upsert(project("source", "Before", sourceProjectRoot));
    source.close();

    const preview = previewDesktopCatalogMigration(target, [{ kind: "beta", databasePath: sourcePath }]);
    const changedSource = new ProjectCatalog(sourcePath);
    changedSource.update("source", { name: "After" });
    changedSource.close();

    expect(() => applyDesktopCatalogMigration(target, preview, { resolutions: {} })).toThrow(/stale/i);
    expect(target.list()).toEqual([]);
    target.close();
  });

  it("uses the selected source identity while preserving portable target metadata", async () => {
    const root = await makeRoot("latex-desktop-migration-resolution-");
    const projectRoot = join(root, "project"); await mkdir(projectRoot);
    const target = new ProjectCatalog(join(root, "target.sqlite"));
    target.upsert(project("old-id", "Local name", projectRoot, { tags: ["local"], favorite: true }));
    const now = "2026-08-13T00:00:00.000Z";
    const work: ResearchWork = { id: "work", title: "Target research", authors: ["Ada"], createdAt: now, updatedAt: now };
    const research: CatalogProjectResearchItem = {
      projectId: "old-id", workId: work.id, createdAt: now, updatedAt: now, localAttachmentPaths: {},
      item: { id: "item", title: work.title, authors: work.authors ?? [], attachments: [], links: [{ targetId: null, role: "reference" }] }
    };
    target.upsertResearchWork(work);
    target.replaceResearchItems("old-id", [research]);
    const collection = target.createCollection({ name: "Target collection", projectIds: ["old-id"] });
    target.appendSyncEvent({ id: "target-sync", projectId: "old-id", occurredAt: now, state: "synced", level: "info", message: "done" });
    target.appendFileOperation({ id: "target-file", projectId: "old-id", operation: "move", sourcePath: "a.tex", createdAt: now, result: "applied" });
    target.upsertOperationSnapshot({ id: "target-operation", projectId: "old-id", kind: "backup", state: "completed", title: "Backup", createdAt: now, updatedAt: now });
    target.upsertProjectStatusSnapshot({ projectId: "old-id", pathAvailable: true, storageBytes: 99, health: "healthy", issues: [], capturedAt: now });
    const sourcePath = join(root, "source.sqlite");
    const source = new ProjectCatalog(sourcePath);
    source.upsert(project("new-id", "Source name", projectRoot, { tags: ["source"] }));
    source.close();

    const preview = previewDesktopCatalogMigration(target, [{ kind: "stable0111", databasePath: sourcePath }]);
    const result = applyDesktopCatalogMigration(target, preview, {
      resolutions: { [preview.conflicts[0].id]: "useSource" }
    });
    expect(result).toMatchObject({ imported: 0, merged: 1, skipped: 0 });
    expect(target.get("old-id")).toBeUndefined();
    expect(target.get("new-id")).toMatchObject({
      name: "Source name", tags: ["source", "local"], favorite: true
    });
    expect(target.researchItems("new-id")).toMatchObject([{ projectId: "new-id", workId: "work" }]);
    expect(target.listCollections().find(({ id }) => id === collection.id)?.projectIds).toEqual(["new-id"]);
    expect(target.syncHistory("new-id")).toMatchObject([{ id: "target-sync", projectId: "new-id" }]);
    expect(target.fileOperationHistory("new-id")).toMatchObject([{ id: "target-file", projectId: "new-id" }]);
    expect(target.operationSnapshots("new-id")).toMatchObject([{ id: "target-operation", projectId: "new-id" }]);
    expect(target.projectStatusSnapshot("new-id")).toMatchObject({ projectId: "new-id", storageBytes: 99 });
    target.close();
  });

  it("merges related SQLite data from both desktop sources", async () => {
    const root = await makeRoot("latex-desktop-migration-data-");
    const stableRoot = join(root, "stable-project"); const betaRoot = join(root, "beta-project");
    await Promise.all([mkdir(stableRoot), mkdir(betaRoot)]);
    const target = new ProjectCatalog(join(root, "target.sqlite"));
    const stablePath = join(root, "stable.sqlite"); const betaPath = join(root, "beta.sqlite");
    const now = "2026-08-13T01:00:00.000Z";

    const stable = new ProjectCatalog(stablePath);
    stable.upsert(project("stable-project", "Stable", stableRoot));
    stable.setRuntimeSettings({ closeToTray: false, onboardingCompleted: true, syncPaused: true, theme: "dark", density: "compact", glassMode: "off" });
    stable.createCollection({ name: "Imported collection", projectIds: ["stable-project"] });
    stable.createSmartView({ name: "Imported view", filter: { favorite: true } });
    stable.appendSyncEvent({ id: "stable-sync", projectId: "stable-project", occurredAt: now, state: "synced", level: "info", message: "stable" });
    const stableWork: ResearchWork = { id: "stable-work", title: "Stable paper", authors: [], createdAt: now, updatedAt: now };
    stable.upsertResearchWork(stableWork);
    stable.replaceResearchItems("stable-project", [{
      projectId: "stable-project", workId: stableWork.id, createdAt: now, updatedAt: now, localAttachmentPaths: {},
      item: { id: "stable-item", title: stableWork.title, authors: [], attachments: [], links: [] }
    }]);
    stable.upsertOperationSnapshot({ id: "stable-operation", projectId: "stable-project", kind: "sync", state: "completed", title: "Synced", createdAt: now, updatedAt: now });
    stable.upsertProjectStatusSnapshot({ projectId: "stable-project", pathAvailable: true, storageBytes: 10, health: "healthy", issues: [], capturedAt: now });
    stable.close();

    const beta = new ProjectCatalog(betaPath);
    beta.upsert(project("beta-project", "Beta", betaRoot));
    beta.appendSyncEvent({ id: "beta-sync", projectId: "beta-project", occurredAt: now, state: "queued", level: "info", message: "beta" });
    beta.appendFileOperation({ id: "beta-file", projectId: "beta-project", operation: "rename", sourcePath: "old.tex", destinationPath: "new.tex", createdAt: now, result: "applied" });
    beta.close();

    const preview = previewDesktopCatalogMigration(target, [
      { kind: "stable0111", databasePath: stablePath }, { kind: "beta", databasePath: betaPath }
    ]);
    applyDesktopCatalogMigration(target, preview, { resolutions: {} });

    expect(target.runtimeSettings()).toMatchObject({ onboardingCompleted: true, theme: "dark", density: "compact" });
    expect(target.listCollections()).toMatchObject([{ name: "Imported collection", projectIds: ["stable-project"] }]);
    expect(target.listSmartViews()).toMatchObject([{ name: "Imported view", filter: { favorite: true } }]);
    expect(target.researchWorks()).toMatchObject([{ id: "stable-work", title: "Stable paper" }]);
    expect(target.researchItems("stable-project")).toMatchObject([{ workId: "stable-work" }]);
    expect(target.syncHistory("stable-project")).toMatchObject([{ id: "stable-sync" }]);
    expect(target.syncHistory("beta-project")).toMatchObject([{ id: "beta-sync" }]);
    expect(target.operationSnapshots("stable-project")).toMatchObject([{ id: "stable-operation" }]);
    expect(target.projectStatusSnapshot("stable-project")).toMatchObject({ storageBytes: 10 });
    expect(target.fileOperationHistory("beta-project")).toMatchObject([{ id: "beta-file" }]);
    target.close();
  });

  it("rolls back the complete migration when a later database row fails", async () => {
    const root = await makeRoot("latex-desktop-migration-atomic-");
    const firstRoot = join(root, "first"); const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const target = new ProjectCatalog(join(root, "target.sqlite"));
    const sourcePath = join(root, "source.sqlite");
    const source = new ProjectCatalog(sourcePath);
    source.upsert(project("first", "First", firstRoot));
    source.upsert(project("second", "Second", secondRoot));
    source.close();

    const preview = previewDesktopCatalogMigration(target, [{ kind: "beta", databasePath: sourcePath }]);
    const atomicApply = target.applyDesktopMigrationAtomically.bind(target);
    target.applyDesktopMigrationAtomically = (summaries, sources, remaps) => atomicApply([
      ...summaries, { ...project("invalid", "Invalid", join(root, "invalid")), name: undefined as never }
    ], sources, remaps);

    expect(() => applyDesktopCatalogMigration(target, preview, { resolutions: {} })).toThrow();
    expect(target.list()).toEqual([]);
    expect(target.status()).toMatchObject({ writable: true, mode: "readWrite" });
    target.close();
  });
});
