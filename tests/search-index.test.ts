import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectCatalog } from "../src/main/services/catalog";
import { ProjectSearchIndexService } from "../src/main/services/search-index";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("incremental project search index", () => {
  it("indexes LaTeX structure and removes stale files without touching sources", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-search-index-")); temporaryDirectories.push(base);
    const root = join(base, "project"); await mkdir(root);
    const tex = join(root, "main.tex"); const bib = join(root, "refs.bib");
    await writeFile(tex, "\\chapter{Graph Connectivity}\n\\label{ch:connectivity}\nSee \\cite{ada2026}.\n", "utf8");
    await writeFile(bib, "@article{ada2026,\n title={A Connected Graph}\n}\n", "utf8");
    const catalog = new ProjectCatalog(join(base, "library.sqlite"));
    const project = catalog.upsert({ id: "project-search", name: "Graph Notes", rootPath: root, targetCount: 1,
      classNames: ["book"], favorite: false, archived: false, trashed: false, tags: ["graph"], pathAvailable: true, description: "research" });
    const service = new ProjectSearchIndexService(catalog);

    expect((await service.index(project)).indexedFiles).toBe(2);
    expect(service.search("Connectivity").map((hit) => hit.kind)).toContain("heading");
    expect(service.search("ch:connectivity")).toMatchObject([{ kind: "label", relativePath: "main.tex", line: 2 }]);
    expect(service.search("ada2026").map((hit) => hit.kind).sort()).toEqual(["bib", "citation"]);
    expect(service.search("Graph Notes")).toMatchObject([{ kind: "project", projectId: "project-search" }]);

    await unlink(bib);
    expect((await service.index(project)).removedFiles).toBe(1);
    expect(service.search("A Connected Graph")).toEqual([]);
    catalog.close();
  });
});
