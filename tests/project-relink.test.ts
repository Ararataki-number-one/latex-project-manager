import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectCatalog } from "../src/main/services/catalog";
import { writeProjectManifest } from "../src/main/services/manifest";
import { relinkCatalogProject } from "../src/main/services/project-relink";
import type { ProjectManifest, ProjectSummary } from "../src/shared/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function manifest(projectId: string): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId,
    name: "Moved Book",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assets: [],
    targets: [{
      id: "main",
      name: "Main",
      entry: "main.tex",
      engine: "auto",
      classConfig: { name: "book", options: {}, rawOptions: [] },
      packages: [],
      structure: [],
      profiles: [{
        id: "full",
        name: "Full",
        chapterState: {},
        numbering: "preserve",
        enabledBlocks: {},
        order: []
      }]
    }]
  };
}

async function writeManagedProject(root: string, projectId: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "main.tex"), "\\documentclass{book}\n\\begin{document}x\\end{document}\n", "utf8");
  await writeProjectManifest(root, manifest(projectId));
}

function summary(projectId: string, rootPath: string): ProjectSummary {
  return {
    id: projectId,
    name: "Moved Book",
    rootPath,
    targetCount: 1,
    classNames: ["book"],
    favorite: true,
    archived: false,
    trashed: false,
    tags: ["managed"],
    pathAvailable: true
  };
}

describe("project relinking", () => {
  it("preserves the catalog ID and metadata after the project directory moves", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-relink-")));
    temporaryDirectories.push(base);
    const original = join(base, "original");
    const moved = join(base, "moved");
    const projectId = "project-stable-id";
    await writeManagedProject(original, projectId);
    const catalog = new ProjectCatalog(join(base, "library.sqlite"));
    try {
      catalog.upsert(summary(projectId, original));
      await rename(original, moved);

      const result = await relinkCatalogProject(catalog, projectId, moved);
      expect(result).toMatchObject({
        id: projectId,
        rootPath: moved,
        favorite: true,
        tags: ["managed"],
        pathAvailable: true
      });
      expect(catalog.get(projectId)?.id).toBe(projectId);
    } finally {
      catalog.close();
    }
  });

  it("rejects a valid LaTeX directory whose manifest belongs to another project", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-relink-")));
    temporaryDirectories.push(base);
    const original = join(base, "original");
    const wrong = join(base, "wrong");
    await writeManagedProject(original, "project-requested");
    await writeManagedProject(wrong, "project-other");
    const catalog = new ProjectCatalog(join(base, "library.sqlite"));
    try {
      catalog.upsert(summary("project-requested", original));
      await expect(relinkCatalogProject(catalog, "project-requested", wrong))
        .rejects.toThrow(/different project/);
      expect(catalog.get("project-requested")?.rootPath).toBe(original);
    } finally {
      catalog.close();
    }
  });
});
