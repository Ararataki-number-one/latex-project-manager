import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MANAGED_MARKERS } from "../src/shared/constants";
import type { BuildProfile, DocumentTarget } from "../src/shared/types";
import { createProfileRuntime, includeAuxiliaryDirectories, renderLatexmkrc, renderProfileStructure } from "../src/main/services/profile-runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fixture(): { target: DocumentTarget; profile: BuildProfile } {
  const profile: BuildProfile = {
    id: "draft",
    name: "Draft",
    chapterState: { one: "full", two: "titleOnly", three: "hidden" },
    numbering: "preserve",
    enabledBlocks: {},
    order: ["two", "one", "three"]
  };
  const target: DocumentTarget = {
    id: "book",
    name: "Book",
    entry: "main.tex",
    engine: "xelatex",
    classConfig: { name: "book", options: {}, rawOptions: [] },
    packages: [],
    profiles: [profile],
    structure: [
      {
        id: "one", kind: "chapter", title: "One", path: "chapters/one.tex", phase: "mainmatter",
        order: 0, originalNumber: 1, titleSource: "file", headingSource: "\\chapter{One}",
        contentSource: "chapters/one.tex", managed: true
      },
      {
        id: "two", kind: "chapter", title: "Two", path: "chapters/two.tex", phase: "mainmatter",
        order: 1, originalNumber: 4, titleSource: "file", headingSource: "\\chapter{Two}",
        contentSource: "chapters/two.tex", managed: true
      },
      {
        id: "three", kind: "chapter", title: "Three", path: "chapters/three.tex", phase: "mainmatter",
        order: 2, originalNumber: 5, titleSource: "file", headingSource: "\\chapter{Three}",
        contentSource: "chapters/three.tex", managed: true
      }
    ]
  };
  return { target, profile };
}

describe("build profile runtime", () => {
  it("renders full, title-only and hidden chapters in profile order", () => {
    const { target, profile } = fixture();
    const rendered = renderProfileStructure(target, profile);
    expect(rendered.indexOf("\\chapter{Two}")).toBeLessThan(rendered.indexOf("chapters/one.tex"));
    expect(rendered).toContain("\\LWPreserveChapter{4}\n\\chapter{Two}");
    expect(rendered).not.toContain("chapters/two.tex");
    expect(rendered).not.toContain("Three");
    expect(rendered).toContain("\\input{chapters/one.tex}");
  });

  it("generates isolated files and preserves the original include command", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-workbench-profile-"));
    temporaryDirectories.push(root);
    const { target, profile } = fixture();
    const source = [
      "\\documentclass{book}",
      "\\begin{document}",
      MANAGED_MARKERS.structure.begin,
      "\\include{chapters/one}",
      "\\input{chapters/two}",
      "\\subfile{chapters/three}",
      MANAGED_MARKERS.structure.end,
      "\\end{document}",
      ""
    ].join("\n");
    await writeFile(join(root, "main.tex"), source, "utf8");

    const runtime = await createProfileRuntime(root, target, profile);
    const generated = await readFile(runtime.generatedEntryPath, "utf8");
    const wrapper = await readFile(runtime.wrapperPath, "utf8");
    expect(runtime.buildDirectory).toContain(join(".latex-workbench", "build", "book", "draft"));
    expect(generated).toContain("\\include{chapters/one}");
    expect(generated).not.toContain("\\input{chapters/two}");
    expect(wrapper).toContain("% !TEX program = xelatex");
    expect(wrapper).toContain(`\\def\\input@path{{${root.replaceAll("\\", "/")}/}}`);
    expect(await readFile(runtime.latexmkrcPath, "utf8")).toContain("BIBINPUTS");
    expect((await stat(join(runtime.buildDirectory, "chapters"))).isDirectory()).toBe(true);
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe(source);
  });

  it("rejects unsafe include auxiliary paths", () => {
    expect(() => includeAuxiliaryDirectories("\\include{../outside/chapter}")).toThrow("Unsafe \\include");
    const warnings: string[] = [];
    expect(includeAuxiliaryDirectories("\\include{chapters/\\jobname}", warnings)).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining("Dynamic \\include path was preserved")]);
    expect(includeAuxiliaryDirectories("% \\include{ignored/out}\n\\include{parts/one}")).toEqual(["parts"]);
  });

  it("adds nested entry, project, and build roots to the VS Code latexmk environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-workbench-profile-"));
    temporaryDirectories.push(root);
    const entryDirectory = join(root, "docs");
    const buildDirectory = join(root, ".latex-workbench", "build", "book", "draft");
    const source = renderLatexmkrc(root, entryDirectory, buildDirectory).replaceAll("\\", "/");
    expect(source).toContain(`${entryDirectory.replaceAll("\\", "/")}//`);
    expect(source).toContain(`${root.replaceAll("\\", "/")}//`);
    expect(source).toContain(`${buildDirectory.replaceAll("\\", "/")}//`);
    expect(source).toContain("TEXINPUTS");
    expect(source).toContain("BIBINPUTS");
    expect(source).toContain("BSTINPUTS");
  });

  it("removes preserve-counter directives in continuous numbering mode", () => {
    const { target, profile } = fixture();
    const rendered = renderProfileStructure(target, { ...profile, numbering: "continuous" });
    expect(rendered).not.toContain("LWPreserveChapter");
  });
});
