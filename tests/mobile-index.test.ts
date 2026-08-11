import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MobileIndexService } from "../src/main/services/mobile-index";
import { parseMobileProjectIndex } from "../src/shared/schema";
import type { MobileProjectIndex, ProjectManifest } from "../src/shared/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function manifest(): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId: "project-mobile",
    name: "Mobile",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    assets: [],
    targets: [{
      id: "target-main",
      name: "Main",
      entry: "main.tex",
      engine: "auto",
      classConfig: { name: "book", options: {}, rawOptions: [] },
      packages: [],
      structure: [],
      profiles: [{ id: "full", name: "Full", chapterState: {}, numbering: "preserve", enabledBlocks: {}, order: [] }]
    }]
  };
}

function index(): MobileProjectIndex {
  return {
    schemaVersion: 1,
    projectId: "project-mobile",
    name: "Mobile",
    updatedAt: "2026-08-11T00:00:00.000Z",
    defaultOutputId: "mobile-target-main",
    outputs: [{
      id: "mobile-target-main",
      name: "Main",
      targetId: "target-main",
      entry: "main.tex",
      profileId: "full",
      pdfPath: "output/main.pdf"
    }]
  };
}

describe("mobile project index", () => {
  it("writes UTF-8/LF atomically and reads the validated project-relative PDF", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-mobile-index-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "output"));
    await writeFile(join(root, "output", "main.pdf"), "%PDF-1.7\n", "utf8");
    const service = new MobileIndexService();

    const saved = await service.write(root, manifest(), index());
    const bytes = await readFile(join(root, ".latex-project.json"));

    expect(saved.updatedAt).not.toBe(index().updatedAt);
    expect(bytes.includes(13)).toBe(false);
    expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({ defaultOutputId: "mobile-target-main" });
    await expect(service.read(root)).resolves.toMatchObject({ projectId: "project-mobile" });
  });

  it("rejects traversal, absolute paths, non-PDF paths and damaged JSON", async () => {
    for (const pdfPath of ["../secret.pdf", "C:/secret.pdf", "/secret.pdf", "output/main.tex"]) {
      expect(() => parseMobileProjectIndex({ ...index(), outputs: [{ ...index().outputs[0], pdfPath }] })).toThrow();
    }
    const root = await mkdtemp(join(tmpdir(), "latex-mobile-index-broken-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, ".latex-project.json"), "{broken", "utf8");
    await expect(new MobileIndexService().read(root)).rejects.toThrow(/有效的 JSON/);
  });

  it("does not suggest references or isolated build output", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-mobile-candidates-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "references"));
    await mkdir(join(root, ".latex-workbench", "build"), { recursive: true });
    await mkdir(join(root, "output"));
    await writeFile(join(root, "references", "source.pdf"), "%PDF", "utf8");
    await writeFile(join(root, ".latex-workbench", "build", "main.pdf"), "%PDF", "utf8");
    await writeFile(join(root, "output", "main.pdf"), "%PDF", "utf8");

    const candidates = await new MobileIndexService().candidates(root, manifest());
    expect(candidates.map((candidate) => candidate.relativePath)).toEqual(["output/main.pdf"]);
    expect(candidates[0].suggestedTargetIds).toEqual(["target-main"]);
  });
});
