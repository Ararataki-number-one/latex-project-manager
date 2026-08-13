import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBackupService } from "../src/main/services/project-backups";
import type { CatalogProjectResearchItem, ProjectSummary } from "../src/shared/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("project backups", () => {
  it("creates a verified snapshot, includes local-only research, excludes private caches, and restores to a new directory", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "latex-project-backup-"));
    temporaryDirectories.push(temporary);
    const root = join(temporary, "project");
    const backupRoot = join(temporary, "backups");
    const external = join(temporary, "licensed-paper.pdf");
    await mkdir(join(root, "chapters"), { recursive: true });
    await mkdir(join(root, ".latex-workbench", "undo", "private"), { recursive: true });
    await mkdir(join(root, ".latex-workbench", "local-research-recovered", "old-private"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "main.tex"), "\\documentclass{book}\n\\input{chapters/one}\n");
    await writeFile(join(root, "chapters", "one.tex"), "\\chapter{One}\n");
    await writeFile(join(root, "main.aux"), "generated");
    await writeFile(join(root, ".latex-workbench", "undo", "private", "secret.tex"), "secret");
    await writeFile(join(root, ".latex-workbench", "local-research-recovered", "old-private", "paper.pdf"), "stale recovered private material");
    await writeFile(join(root, ".git", "config"), "git");
    await writeFile(external, "%PDF-1.7\nlicensed");

    const project: ProjectSummary = {
      id: "project-one",
      name: "Project One",
      rootPath: root,
      targetCount: 1,
      classNames: ["book"],
      favorite: false,
      archived: false,
      trashed: false,
      tags: [],
      pathAvailable: true,
      lifecycle: "active",
      protectionState: "unprotected"
    };
    const research: CatalogProjectResearchItem[] = [{
      projectId: project.id,
      workId: "work-one",
      item: {
        id: "item-one",
        title: "Licensed paper",
        authors: [],
        attachments: [{ id: "attachment-one", name: "licensed-paper.pdf", mediaType: "application/pdf", availability: "localOnly" }],
        links: [{ targetId: null, role: "primarySource" }]
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      localAttachmentPaths: { "attachment-one": external }
    }];

    const service = new ProjectBackupService(backupRoot);
    const preview = await service.preview(project, research);
    expect(preview.fileCount).toBe(3);
    expect(preview.localOnlyAttachmentCount).toBe(1);
    expect(preview.excludedPaths).toEqual(expect.arrayContaining([
      ".git",
      ".latex-workbench/undo",
      ".latex-workbench/local-research-recovered"
    ]));

    const snapshot = await service.create(project, research);
    expect(snapshot.verified).toBe(true);
    expect((await service.verify(project.id, snapshot.id)).valid).toBe(true);

    const restore = join(temporary, "restored-project");
    const result = await service.restore(project.id, snapshot.id, restore);
    expect(result.restoredFiles).toBe(2);
    expect(result.restoredLocalAttachments).toBe(1);
    expect(await readFile(join(restore, "main.tex"), "utf8")).toContain("documentclass");
    expect(await readFile(join(restore, ".latex-workbench", "local-research-recovered", "attachment-one", "licensed-paper.pdf"), "utf8")).toContain("%PDF");
    expect(JSON.parse(await readFile(join(restore, ".latex-workbench", "local-research-recovered", "restore-map.json"), "utf8"))).toMatchObject({
      projectId: project.id,
      attachments: [{ attachmentId: "attachment-one" }]
    });
    await expect(readFile(join(restore, ".git", "config"), "utf8")).rejects.toThrow();
    await expect(readFile(join(restore, "main.aux"), "utf8")).rejects.toThrow();
    await expect(service.restore(project.id, snapshot.id, restore)).rejects.toThrow(/新目录/);
  });

  it("persists verification across restarts and only prunes after a new verified snapshot", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "latex-project-backup-settings-"));
    temporaryDirectories.push(temporary);
    const root = join(temporary, "project");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "main.tex"), "test");
    const project: ProjectSummary = {
      id: "project-two", name: "Project Two", rootPath: root, targetCount: 1, classNames: [],
      favorite: false, archived: false, trashed: false, tags: [], pathAvailable: true
    };
    const service = new ProjectBackupService(join(temporary, "backups"));
    await service.create(project, []);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.create(project, []);
    expect(await new ProjectBackupService(join(temporary, "backups")).list(project.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ verified: true, verifiedAt: expect.any(String) })])
    );
    expect(await service.setSettings(project.id, { frequency: "daily", retainCount: 1 })).toMatchObject({ frequency: "daily", retainCount: 1 });
    // Changing retention is not itself a destructive operation. Cleanup waits
    // until a replacement snapshot has been successfully written and checked.
    expect(await service.list(project.id)).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.create(project, []);
    expect(await service.list(project.id)).toHaveLength(1);
  });

  it("rejects a snapshot when a source changes during the copy and preserves known-good backups", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "latex-project-backup-race-"));
    temporaryDirectories.push(temporary);
    const root = join(temporary, "project");
    const backupRoot = join(temporary, "backups");
    await mkdir(root, { recursive: true });
    const source = join(root, "main.tex");
    await writeFile(source, "A".repeat(64 * 1024 * 1024));
    const project: ProjectSummary = {
      id: "project-race", name: "Project Race", rootPath: root, targetCount: 1, classNames: [],
      favorite: false, archived: false, trashed: false, tags: [], pathAvailable: true
    };
    const service = new ProjectBackupService(backupRoot);
    const knownGood = await service.create(project, []);
    const create = service.create(project, []);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(source, "changed externally");

    await expect(create).rejects.toThrow(/外部修改|发生变化/);
    expect(await service.list(project.id)).toEqual([expect.objectContaining({ id: knownGood.id, verified: true })]);
  }, 30_000);

  it("removes abandoned temporary snapshot directories without touching verified snapshots", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "latex-project-backup-temp-"));
    temporaryDirectories.push(temporary);
    const root = join(temporary, "project");
    const backupRoot = join(temporary, "backups");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "main.tex"), "test");
    const project: ProjectSummary = {
      id: "project-temp", name: "Project Temp", rootPath: root, targetCount: 1, classNames: [],
      favorite: false, archived: false, trashed: false, tags: [], pathAvailable: true
    };
    const service = new ProjectBackupService(backupRoot);
    const snapshot = await service.create(project, []);
    const abandoned = join(backupRoot, project.id, "abandoned.tmp");
    await mkdir(abandoned, { recursive: true });
    await writeFile(join(abandoned, "partial"), "partial");

    expect(await service.cleanupTemporaryArtifacts(project.id)).toBe(1);
    expect(await service.list(project.id)).toEqual([expect.objectContaining({ id: snapshot.id, verified: true })]);
    expect(await service.dispose()).toMatchObject({ timedOut: false });
    await expect(service.create(project, [])).rejects.toThrow(/正在关闭/);
  });

  it("tracks and aborts restore work without publishing a partial destination", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "latex-project-backup-restore-cancel-"));
    temporaryDirectories.push(temporary);
    const root = join(temporary, "project");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "main.tex"), "test");
    const project: ProjectSummary = {
      id: "project-restore-cancel", name: "Restore Cancel", rootPath: root, targetCount: 1, classNames: [],
      favorite: false, archived: false, trashed: false, tags: [], pathAvailable: true
    };
    const service = new ProjectBackupService(join(temporary, "backups"));
    const snapshot = await service.create(project, []);
    const destination = join(temporary, "cancelled-restore");
    const controller = new AbortController();
    controller.abort();

    await expect(service.restore(project.id, snapshot.id, destination, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    await expect(readFile(join(destination, "main.tex"), "utf8")).rejects.toThrow();
    expect(await service.dispose()).toMatchObject({ timedOut: false });
  });
});
