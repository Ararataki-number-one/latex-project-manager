import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyPortableResourceMigration,
  previewPortableResourceMigration
} from "../src/main/services/portable-resource-migration";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("portable desktop resource migration", () => {
  it("copies missing GitHub settings, backups and templates without overwriting formal data", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "desktop-resources-"));
    temporaryDirectories.push(temporary);
    const beta = join(temporary, "beta");
    const stable = join(temporary, "stable");
    await mkdir(join(beta, "github-sync"), { recursive: true });
    await mkdir(join(beta, "project-backups", "p1", "snapshot"), { recursive: true });
    await mkdir(join(beta, "templates", "book"), { recursive: true });
    await mkdir(join(stable, "github-sync"), { recursive: true });
    await writeFile(join(beta, "github-sync", "project.json"), "beta config");
    await writeFile(join(stable, "github-sync", "project.json"), "stable config");
    await writeFile(join(beta, "project-backups", "p1", "snapshot", "main.tex"), "backup");
    await writeFile(join(beta, "templates", "book", "main.tex"), "template");

    const plan = await previewPortableResourceMigration([beta], stable);
    expect(plan.conflicts).toEqual(["github-sync/project.json"]);
    expect(plan.entries.map((entry) => entry.relativePath)).toEqual(expect.arrayContaining([
      "project-backups/p1/snapshot/main.tex",
      "templates/book/main.tex"
    ]));

    const result = await applyPortableResourceMigration(plan);
    expect(result).toMatchObject({ copied: 2, conflicts: ["github-sync/project.json"], failures: [] });
    expect(await readFile(join(stable, "github-sync", "project.json"), "utf8")).toBe("stable config");
    expect(await readFile(join(stable, "project-backups", "p1", "snapshot", "main.tex"), "utf8")).toBe("backup");
    expect(await readFile(join(stable, "templates", "book", "main.tex"), "utf8")).toBe("template");
  });

  it("rechecks conflicts during apply and never overwrites a target created after preview", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "desktop-resources-race-"));
    temporaryDirectories.push(temporary);
    const beta = join(temporary, "beta");
    const stable = join(temporary, "stable");
    await mkdir(join(beta, "templates"), { recursive: true });
    await writeFile(join(beta, "templates", "new.tex"), "old version");
    const plan = await previewPortableResourceMigration([beta], stable);
    await mkdir(join(stable, "templates"), { recursive: true });
    await writeFile(join(stable, "templates", "new.tex"), "formal version");

    const result = await applyPortableResourceMigration(plan);
    expect(result).toMatchObject({ copied: 0, conflicts: ["templates/new.tex"] });
    expect(await readFile(join(stable, "templates", "new.tex"), "utf8")).toBe("formal version");
  });
});
