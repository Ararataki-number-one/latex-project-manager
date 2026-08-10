import { describe, expect, it } from "vitest";

import {
  collectTargetAssets,
  collectTargetSourcePaths,
  describeClass,
  formatFileEncoding,
  formatLineEnding,
  packageNotices
} from "../src/renderer/project-display";
import type { DocumentTarget } from "../src/shared/types";

const genericTarget: DocumentTarget = {
  id: "graph-notes",
  name: "Graph notes",
  entry: "book.tex",
  engine: "pdflatex",
  classConfig: {
    name: "article",
    source: "texlive",
    options: { a4paper: true },
    rawOptions: ["11pt"]
  },
  packages: [
    { id: "amsmath", name: "amsmath", options: [], enabled: true, order: 0, source: "managed", diagnostic: "ok" }
  ],
  structure: [
    { id: "first", kind: "input", title: "First", path: "sections/first.tex", phase: "mainmatter", order: 0, managed: true },
    { id: "duplicate", kind: "input", title: "Duplicate", path: "sections\\first.tex", phase: "mainmatter", order: 1, managed: true },
    { id: "toc", kind: "toc", title: "Contents", phase: "frontmatter", order: 2, managed: true }
  ],
  profiles: [{ id: "full", name: "Full", chapterState: {}, numbering: "preserve", enabledBlocks: {}, order: ["first", "duplicate", "toc"] }]
};

describe("project management display data", () => {
  it("lists only the entry and real structure paths", () => {
    expect(collectTargetSourcePaths(genericTarget)).toEqual(["book.tex", "sections/first.tex"]);
  });

  it("formats encoding and line endings from file read metadata", () => {
    expect(formatFileEncoding({ encoding: "utf8-bom" })).toBe("UTF-8 BOM");
    expect(formatLineEnding({ lineEnding: "crlf" })).toBe("CRLF");
    expect(formatFileEncoding(null)).toBe("编码未知");
    expect(formatLineEnding(null)).toBe("换行未知");
  });

  it("keeps generic document class copy generic", () => {
    expect(describeClass(genericTarget.classConfig)).toEqual(expect.objectContaining({
      isElegantBook: false,
      title: "article 配置",
      source: "TeX 发行版",
      badge: "TeX 发行版提供"
    }));
  });

  it("does not leak another target's pinned class into a generic target", () => {
    const assets = [{
      id: "elegantbook-fork",
      kind: "class" as const,
      path: "elegantbook.cls",
      hash: "0".repeat(64),
      source: "user fork v4.6"
    }];

    expect(collectTargetAssets(genericTarget, assets)).toEqual([]);
    expect(collectTargetAssets({
      ...genericTarget,
      classConfig: {
        name: "elegantbook",
        source: "project",
        sourcePath: "elegantbook.cls",
        sourceHash: "0".repeat(64),
        options: {},
        rawOptions: []
      }
    }, assets)).toEqual(assets);
  });

  it("derives package notices from the current target diagnostics", () => {
    expect(packageNotices(genericTarget.packages, genericTarget.classConfig.name)).toEqual([]);
    expect(packageNotices([
      { id: "xcolor", name: "xcolor", options: [], enabled: true, order: 0, source: "class", diagnostic: "duplicate" }
    ], "article")[0]).toEqual(expect.objectContaining({
      title: "xcolor 被重复加载",
      detail: expect.stringContaining("article.cls")
    }));
  });

  it("retains the ElegantBook-specific presentation only for that class", () => {
    expect(describeClass({
      name: "elegantbook",
      source: "project",
      sourcePath: "elegantbook.cls",
      sourceHash: "0".repeat(64),
      options: {},
      rawOptions: []
    })).toEqual(expect.objectContaining({
      isElegantBook: true,
      title: "ElegantBook 配置",
      badge: "项目内 · 哈希固定"
    }));
  });
});
