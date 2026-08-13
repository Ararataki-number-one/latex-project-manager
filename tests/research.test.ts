import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProjectCatalog } from "../src/main/services/catalog";
import { ResearchService } from "../src/main/services/research";
import type { ProjectManifest, ProjectResearchItem, ProjectSummary } from "../src/shared/types";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function manifest(projectId: string): ProjectManifest {
  return {
    schemaVersion: 1, projectId, name: projectId, createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z", assets: [],
    targets: [{
      id: "target-main", name: "Main", entry: "main.tex", engine: "auto",
      classConfig: { name: "book", options: {}, rawOptions: [] }, packages: [], structure: [],
      profiles: [{ id: "full", name: "Full", chapterState: {}, numbering: "preserve", enabledBlocks: {}, order: [] }]
    }]
  };
}

function summary(projectId: string, rootPath: string): ProjectSummary {
  return { id: projectId, name: projectId, rootPath, targetCount: 1, classNames: ["book"], favorite: false, archived: false, trashed: false, tags: [], pathAvailable: true };
}

function item(id: string, relativePath: string): ProjectResearchItem {
  return {
    id, title: "Shared paper", authors: ["Ada"], year: 2026,
    attachments: [{ id: `${id}-file`, name: "paper.pdf", relativePath, mediaType: "application/pdf", availability: "repository" }],
    links: [{ targetId: "target-main", role: "primarySource", preferredAttachmentId: `${id}-file` }]
  };
}

describe("research material catalog", () => {
  it("discovers legacy references without creating or rewriting project files", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-research-legacy-")); temporaryDirectories.push(base);
    const root = join(base, "project"); await mkdir(root);
    const catalog = createProjectCatalog(join(base, "library.sqlite")); catalog.upsert(summary("project-a", root));
    const service = new ResearchService(catalog);

    await expect(service.discoverLegacy("project-a", root)).resolves.toEqual([]);
    await expect(lstat(join(root, "references"))).rejects.toMatchObject({ code: "ENOENT" });
    await mkdir(join(root, "references"));
    await writeFile(join(root, "references", "paper.pdf"), "%PDF legacy\n", "utf8");
    const found = await service.discoverLegacy("project-a", root);
    expect(found).toMatchObject([{ relativePath: "references/paper.pdf", pendingTargetAssignment: true, duplicateItemIds: [] }]);
    catalog.close();
  });

  it("stores private paths only in SQLite and emits portable v3 metadata", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-research-save-")); temporaryDirectories.push(base);
    const root = join(base, "project"); await mkdir(join(root, "references"), { recursive: true });
    await writeFile(join(root, "references", "paper.pdf"), "%PDF paper\n", "utf8");
    const privatePdf = join(base, "private.pdf"); await writeFile(privatePdf, "%PDF private\n", "utf8");
    const catalog = createProjectCatalog(join(base, "library.sqlite")); catalog.upsert(summary("project-a", root));
    const service = new ResearchService(catalog);
    const researchItem = item("paper-a", "references/paper.pdf");
    researchItem.links = [];
    researchItem.attachments.push({ id: "private-file", name: "private.pdf", mediaType: "application/pdf", availability: "localOnly" });

    const saved = await service.save("project-a", root, manifest("project-a"), {
      items: [researchItem], localAttachmentPaths: { "private-file": privatePdf }
    });
    expect(saved[0].localAttachmentPaths).toEqual({ "private-file": privatePdf });
    expect(saved[0].item.links).toEqual([]);
    const portable = JSON.parse(await readFile(join(root, ".latex-project.json"), "utf8"));
    expect(portable).toMatchObject({ schemaVersion: 3, outputs: [], researchItems: [{ id: "paper-a" }] });
    expect(JSON.stringify(portable)).not.toContain(privatePdf);
    expect(portable.researchItems[0].attachments.find((attachment: { id: string }) => attachment.id === "private-file")).toEqual({
      id: "private-file", name: "private.pdf", mediaType: "application/pdf", availability: "localOnly"
    });
    await expect(service.attachmentPath("project-a", root, "paper-a", "paper-a-file")).resolves.toBe(
      await realpath(join(root, "references", "paper.pdf"))
    );
    await expect(service.attachmentPath("project-a", root, "paper-a", "private-file")).resolves.toBe(await realpath(privatePdf));
    catalog.close();
  });

  it("groups exact copies into one local logical work without deleting either project copy", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-research-dedupe-")); temporaryDirectories.push(base);
    const rootA = join(base, "a"); const rootB = join(base, "b");
    await Promise.all([mkdir(join(rootA, "references"), { recursive: true }), mkdir(join(rootB, "references"), { recursive: true })]);
    await Promise.all([
      writeFile(join(rootA, "references", "paper.pdf"), "same bytes", "utf8"),
      writeFile(join(rootB, "references", "renamed.pdf"), "same bytes", "utf8")
    ]);
    const catalog = createProjectCatalog(join(base, "library.sqlite"));
    catalog.upsert(summary("project-a", rootA)); catalog.upsert(summary("project-b", rootB));
    const service = new ResearchService(catalog);
    const savedA = await service.save("project-a", rootA, manifest("project-a"), { items: [item("item-a", "references/paper.pdf")] });
    const savedB = await service.save("project-b", rootB, manifest("project-b"), { items: [item("item-b", "references/renamed.pdf")] });
    expect(savedB[0].workId).toBe(savedA[0].workId);
    expect(service.listGlobal()).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: "project-a", workId: savedA[0].workId }),
      expect.objectContaining({ projectId: "project-b", workId: savedA[0].workId })
    ]));
    await expect(readFile(join(rootA, "references", "paper.pdf"), "utf8")).resolves.toBe("same bytes");
    await expect(readFile(join(rootB, "references", "renamed.pdf"), "utf8")).resolves.toBe("same bytes");
    catalog.close();
  });

  it("refuses research writes instead of pretending to save in temporary catalog mode", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-research-memory-")); temporaryDirectories.push(base);
    const root = join(base, "project"); await mkdir(join(root, "references"), { recursive: true });
    await writeFile(join(root, "references", "paper.pdf"), "%PDF paper\n", "utf8");
    const catalog = createProjectCatalog(join(base, "library.sqlite"));
    catalog.upsert(summary("project-a", root));
    catalog.close();
    const service = new ResearchService(catalog);

    await expect(service.save("project-a", root, manifest("project-a"), {
      items: [item("item-a", "references/paper.pdf")]
    })).rejects.toThrow(/temporary memory mode/i);
    await expect(lstat(join(root, ".latex-project.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a new public-repository attachment local when an external source is supplied", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-research-public-local-")); temporaryDirectories.push(base);
    const root = join(base, "project"); await mkdir(root);
    const external = join(base, "publisher-copy.pdf"); await writeFile(external, "%PDF external\n", "utf8");
    const catalog = createProjectCatalog(join(base, "library.sqlite")); catalog.upsert(summary("project-a", root));
    const service = new ResearchService(catalog);
    const proposed = item("item-public", "references/publisher-copy.pdf");

    const saved = await service.save("project-a", root, manifest("project-a"), {
      items: [proposed], localAttachmentPaths: { "item-public-file": external }
    }, "public");
    expect(saved[0].item.attachments[0]).toMatchObject({ availability: "localOnly" });
    expect(saved[0].item.attachments[0].relativePath).toBeUndefined();
    expect(saved[0].localAttachmentPaths).toEqual({ "item-public-file": external });
    await expect(lstat(join(root, "references"))).rejects.toMatchObject({ code: "ENOENT" });
    const portable = JSON.parse(await readFile(join(root, ".latex-project.json"), "utf8"));
    expect(portable.researchItems[0].attachments[0]).toEqual({
      id: "item-public-file", name: "paper.pdf", mediaType: "application/pdf", availability: "localOnly"
    });
    catalog.close();
  });

  it("imports public-project material without copying it into the Git worktree", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-research-public-import-")); temporaryDirectories.push(base);
    const root = join(base, "project"); await mkdir(root);
    const external = join(base, "Publisher_Copy-2026.pdf"); await writeFile(external, "%PDF external\n", "utf8");
    const catalog = createProjectCatalog(join(base, "library.sqlite")); catalog.upsert(summary("project-a", root));
    const service = new ResearchService(catalog);

    const saved = await service.importLocalOnlyFiles("project-a", root, manifest("project-a"), [external]);
    expect(saved).toHaveLength(1);
    expect(saved[0].item).toMatchObject({ title: "Publisher Copy 2026", links: [] });
    expect(saved[0].item.attachments[0]).toMatchObject({ availability: "localOnly", name: "Publisher_Copy-2026.pdf" });
    expect(saved[0].localAttachmentPaths[saved[0].item.attachments[0].id]).toBe(await realpath(external));
    await expect(lstat(join(root, "references"))).rejects.toMatchObject({ code: "ENOENT" });
    const portable = JSON.parse(await readFile(join(root, ".latex-project.json"), "utf8"));
    expect(portable.researchItems[0].attachments[0]).not.toHaveProperty("relativePath");
    expect(JSON.stringify(portable)).not.toContain(external);
    catalog.close();
  });

  it("blocks an unapproved new repository attachment in a public repository", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-research-public-block-")); temporaryDirectories.push(base);
    const root = join(base, "project"); await mkdir(join(root, "references"), { recursive: true });
    await writeFile(join(root, "references", "paper.pdf"), "%PDF paper\n", "utf8");
    const catalog = createProjectCatalog(join(base, "library.sqlite")); catalog.upsert(summary("project-a", root));
    const service = new ResearchService(catalog);
    const proposed = item("item-public", "references/paper.pdf");
    // A persisted-looking flag from renderer state is not itself a fresh user
    // confirmation; approval must be part of the save action.
    proposed.attachments[0].publicUploadApproved = true;

    await expect(service.save("project-a", root, manifest("project-a"), {
      items: [proposed]
    }, "public")).rejects.toThrow(/copyright/i);
    expect(service.list("project-a")).toEqual([]);
    await expect(lstat(join(root, ".latex-project.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const saved = await service.save("project-a", root, manifest("project-a"), {
      items: [proposed], publicUploadApprovalIds: ["item-public-file"]
    }, "public");
    expect(saved[0].item.attachments[0].publicUploadApproved).toBe(true);
    catalog.close();
  });
});
