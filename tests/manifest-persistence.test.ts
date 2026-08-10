import { describe, expect, it, vi } from "vitest";

import {
  flushLatestManifest,
  ManifestPersistenceCoordinator
} from "../src/renderer/manifest-persistence";
import type { ProjectManifest } from "../src/shared/types";

function manifest(updatedAt: string, name = updatedAt): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId: "project-stable",
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
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

describe("manifest persistence before build", () => {
  it("waits for an in-flight older save and then persists the newest version", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const written: string[] = [];
    const writer = vi.fn(async (value: ProjectManifest) => {
      written.push(value.updatedAt);
      if (value.updatedAt === "2026-01-01T00:00:01.000Z") await firstBlocked;
      return value;
    });
    const coordinator = new ManifestPersistenceCoordinator(writer);
    coordinator.markPersisted("2026-01-01T00:00:00.000Z");
    const older = manifest("2026-01-01T00:00:01.000Z", "Older");
    const newest = manifest("2026-01-01T00:00:02.000Z", "Newest");
    let current = older;

    const olderSave = coordinator.save(older);
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1));
    current = newest;
    const flushed = flushLatestManifest(coordinator, () => current);
    expect(writer).toHaveBeenCalledTimes(1);
    releaseFirst();

    await expect(flushed).resolves.toMatchObject({ updatedAt: newest.updatedAt, name: "Newest" });
    await olderSave;
    expect(written).toEqual([older.updatedAt, newest.updatedAt]);
  });

  it("rejects before the build operation when the latest manifest cannot be saved", async () => {
    const coordinator = new ManifestPersistenceCoordinator(async () => {
      throw new Error("concurrent manifest edit");
    });
    const build = vi.fn(async () => "build-id");
    const current = manifest("2026-01-01T00:00:03.000Z");

    await expect(
      flushLatestManifest(coordinator, () => current).then(() => build())
    ).rejects.toThrow("concurrent manifest edit");
    expect(build).not.toHaveBeenCalled();
  });
});
