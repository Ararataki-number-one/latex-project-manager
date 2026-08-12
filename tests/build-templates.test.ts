import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TemplateService, verifyTemplateAssets } from "../src/main/services/templates";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local template pins", () => {
  it("pins copied assets and omits generated build files", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-templates-")));
    temporaryDirectories.push(root);
    const source = join(root, "source");
    const store = join(root, "store");
    await mkdir(source);
    await writeFile(join(source, "main.tex"), "\\documentclass{elegantbook}", "utf8");
    await writeFile(join(source, "elegantbook.cls"), "class source", "utf8");
    await writeFile(join(source, "main.aux"), "generated", "utf8");

    const service = new TemplateService(store);
    const template = await service.create(source, "Elegant Book");
    expect(template.className).toBe("elegantbook");
    expect(template.assetPins.map((pin) => pin.path)).toEqual(["elegantbook.cls", "main.tex"]);
    expect(await verifyTemplateAssets(template)).toEqual([]);

    await writeFile(join(template.rootPath, "elegantbook.cls"), "changed", "utf8");
    expect(await verifyTemplateAssets(template)).toEqual([
      expect.objectContaining({ path: "elegantbook.cls", expected: template.assetPins[0].hash })
    ]);
  });

  it("instantiates a verified template atomically with a fresh manifest identity", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-templates-")));
    temporaryDirectories.push(root);
    const source = join(root, "source");
    const store = join(root, "store");
    const projects = join(root, "projects");
    await mkdir(join(source, ".latex-workbench"), { recursive: true });
    await mkdir(projects);
    await writeFile(join(source, "main.tex"), "\\documentclass{book}\n\\begin{document}ok\\end{document}\n", "utf8");
    await writeFile(join(source, ".latex-workbench", "project.json"), JSON.stringify({
      schemaVersion: 1,
      projectId: "project-original",
      name: "Original",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      targets: [{
        id: "target-main",
        name: "Main",
        entry: "main.tex",
        engine: "auto",
        classConfig: { name: "book", options: {}, rawOptions: [] },
        packages: [],
        structure: [],
        profiles: [{ id: "profile-full", name: "Full", chapterState: {}, numbering: "preserve", enabledBlocks: {}, order: [] }]
      }],
      assets: []
    }), "utf8");

    const service = new TemplateService(store);
    const template = await service.create(source, "Book Template");
    const destination = await service.instantiate(template.id, projects, "新讲义");
    const manifest = JSON.parse(await readFile(join(destination, ".latex-workbench", "project.json"), "utf8")) as { projectId: string; name: string };

    expect(destination).toBe(join(projects, "新讲义"));
    expect(manifest.name).toBe("新讲义");
    expect(manifest.projectId).toMatch(/^project-/);
    expect(manifest.projectId).not.toBe("project-original");
    await expect(stat(join(destination, ".latex-template.json"))).rejects.toMatchObject({ code: "ENOENT" });

    await expect(service.instantiate(template.id, projects, "新讲义")).rejects.toThrow("already exists");
    expect(await readFile(join(destination, "main.tex"), "utf8")).toContain("\\documentclass{book}");
  });

  it("rejects unpinned files added to a stored template", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-templates-")));
    temporaryDirectories.push(root);
    const source = join(root, "source");
    const store = join(root, "store");
    const projects = join(root, "projects");
    await mkdir(source);
    await mkdir(projects);
    await writeFile(join(source, "main.tex"), "\\documentclass{article}", "utf8");
    const service = new TemplateService(store);
    const template = await service.create(source, "Article");
    await writeFile(join(template.rootPath, "untracked.tex"), "untracked", "utf8");

    await expect(service.instantiate(template.id, projects, "Copy")).rejects.toThrow("file set verification failed");
    await expect(stat(join(projects, "Copy"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ignores malformed template metadata", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-templates-")));
    temporaryDirectories.push(root);
    const source = join(root, "source");
    const store = join(root, "store");
    await mkdir(source);
    await writeFile(join(source, "main.tex"), "\\documentclass{article}", "utf8");
    const service = new TemplateService(store);
    const template = await service.create(source, "Article");
    await writeFile(join(template.rootPath, ".latex-template.json"), JSON.stringify({ formatVersion: 1, id: template.id, name: 42 }), "utf8");
    expect((await service.list()).some((item) => item.id === template.id)).toBe(false);
  });

  it("provides safe built-in templates and only deletes user templates", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-templates-")));
    temporaryDirectories.push(root);
    const source = join(root, "source");
    const store = join(root, "store");
    await mkdir(source);
    await writeFile(join(source, "main.tex"), "\\documentclass{article}", "utf8");
    const service = new TemplateService(store);

    const initial = await service.list();
    expect(initial.filter((item) => item.source === "builtin").map((item) => item.id)).toEqual(
      expect.arrayContaining(["builtin-article", "builtin-book"])
    );
    expect(initial.every((item) => item.fileCount > 0 && item.totalBytes > 0)).toBe(true);

    const personal = await service.create(source, "Personal", { description: "Local reusable structure", category: "article" });
    expect(personal).toMatchObject({ source: "user", category: "article", description: "Local reusable structure" });
    await expect(service.delete("builtin-article")).rejects.toThrow("cannot be deleted");
    await service.delete(personal.id);
    expect((await service.list()).some((item) => item.id === personal.id)).toBe(false);
    expect(await readFile(join(source, "main.tex"), "utf8")).toBe("\\documentclass{article}");
  });
});
