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
  it("validates the shared cross-platform v3 contract fixtures", async () => {
    const fixtureRoot = join(process.cwd(), "contracts", "mobile-index");
    const valid = JSON.parse(await readFile(join(fixtureRoot, "v3-valid.json"), "utf8")) as unknown;
    const unsafe = JSON.parse(await readFile(join(fixtureRoot, "v3-invalid-path.json"), "utf8")) as unknown;
    expect(parseMobileProjectIndex(valid)).toMatchObject({ schemaVersion: 3, projectId: "project-contract" });
    expect(() => parseMobileProjectIndex(unsafe)).toThrow();
  });

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
    expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({
      schemaVersion: 2,
      defaultOutputId: "mobile-target-main",
      outputs: [{ size: 9, blobSha: expect.stringMatching(/^[a-f0-9]{40}$/), generatedAt: expect.any(String) }]
    });
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

  it("reads both v1 and complete v2 indexes but rejects incomplete v2 metadata", () => {
    expect(parseMobileProjectIndex(index()).schemaVersion).toBe(1);
    expect(parseMobileProjectIndex({
      ...index(),
      schemaVersion: 2,
      outputs: [{
        ...index().outputs[0],
        blobSha: "a".repeat(40),
        size: 12,
        generatedAt: "2026-08-11T00:00:00.000Z"
      }]
    }).schemaVersion).toBe(2);
    expect(() => parseMobileProjectIndex({ ...index(), schemaVersion: 2 })).toThrow(/blobSha/);
  });

  it("writes the cross-platform v3 research contract without requiring a PDF output", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-mobile-v3-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "references"));
    await writeFile(join(root, "references", "paper.pdf"), "%PDF research\n", "utf8");
    const value: MobileProjectIndex = {
      schemaVersion: 3,
      projectId: "project-mobile",
      name: "Mobile",
      updatedAt: "2026-08-11T00:00:00.000Z",
      outputs: [],
      researchItems: [{
        id: "research-paper",
        title: "A paper",
        authors: ["Ada"],
        year: 2026,
        language: "en",
        attachments: [{
          id: "attachment-repository",
          name: "paper.pdf",
          relativePath: "references/paper.pdf",
          mediaType: "application/pdf",
          availability: "repository"
        }, {
          id: "attachment-local",
          name: "private-notes.pdf",
          mediaType: "application/pdf",
          availability: "localOnly"
        }],
        links: [{ targetId: "target-main", role: "primarySource", preferredAttachmentId: "attachment-repository" }]
      }]
    };

    const saved = await new MobileIndexService().write(root, manifest(), value);
    expect(saved).toMatchObject({ schemaVersion: 3, outputs: [], researchItems: [{ id: "research-paper" }] });
    expect(saved.defaultOutputId).toBeUndefined();
    const stored = JSON.parse(await readFile(join(root, ".latex-project.json"), "utf8"));
    expect(stored.researchItems[0].attachments[0]).toMatchObject({
      relativePath: "references/paper.pdf", size: 14, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), gitBlobSha: expect.stringMatching(/^[a-f0-9]{40}$/)
    });
    expect(stored.researchItems[0].attachments[1]).toEqual({
      id: "attachment-local", name: "private-notes.pdf", mediaType: "application/pdf", availability: "localOnly"
    });
  });

  it("keeps v1/v2 output requirements while v3 permits a research-only project", () => {
    expect(() => parseMobileProjectIndex({ ...index(), outputs: [], defaultOutputId: undefined })).toThrow(/v1\/v2/);
    expect(() => parseMobileProjectIndex({ ...index(), schemaVersion: 2, outputs: [], defaultOutputId: undefined })).toThrow(/v1\/v2/);
    expect(parseMobileProjectIndex({
      schemaVersion: 3,
      projectId: "project-mobile",
      name: "Mobile",
      updatedAt: "2026-08-11T00:00:00.000Z",
      outputs: [],
      researchItems: []
    })).toMatchObject({ schemaVersion: 3, outputs: [] });
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
