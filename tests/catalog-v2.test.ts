import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectCatalog } from "../src/main/services/catalog";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("catalog v2 settings and sync history", () => {
  it("persists runtime settings and retains only the newest 100 events per project", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-catalog-v2-"));
    temporaryDirectories.push(root);
    const database = join(root, "library.sqlite");
    let catalog = new ProjectCatalog(database);
    catalog.upsert({
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
      description: ""
    });
    catalog.setRuntimeSettings({
      closeToTray: false,
      onboardingCompleted: true,
      syncPaused: true,
      theme: "dark",
      density: "compact",
      glassMode: "off"
    });
    for (let index = 0; index < 105; index += 1) {
      catalog.appendSyncEvent({
        id: `event-${index}`,
        projectId: "project-one",
        occurredAt: new Date(Date.UTC(2026, 7, 11, 0, 0, index)).toISOString(),
        state: "synced",
        level: "info",
        message: `event ${index}`
      });
    }
    expect(catalog.syncHistory("project-one", 200)).toHaveLength(100);
    expect(catalog.syncHistory("project-one", 1)[0].message).toBe("event 104");
    catalog.close();

    catalog = new ProjectCatalog(database);
    expect(catalog.runtimeSettings()).toEqual({
      closeToTray: false,
      onboardingCompleted: true,
      syncPaused: true,
      theme: "dark",
      density: "compact",
      glassMode: "off"
    });
    expect(catalog.syncHistory("project-one", 200)).toHaveLength(100);
    catalog.close();
  });
});
