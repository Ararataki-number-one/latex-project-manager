import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentTarget, ToolchainInfo } from "../src/shared/types";
import { buildLatexmkArguments, selectBuildEngine } from "../src/main/services/build";
import { detectToolchains, resolveToolchain } from "../src/main/services/toolchain";

describe("TeX toolchain and latexmk invocation", () => {
  it("returns absolute commands from an explicitly checked bin directory", async () => {
    const bin = join(process.cwd(), "texlive", "2026", "bin", process.platform === "win32" ? "windows" : "x86_64-linux");
    const executable = (name: string) => join(bin, process.platform === "win32" ? `${name}.exe` : name);
    const found = new Set([executable("latexmk"), executable("xelatex"), executable("synctex")]);
    const toolchains = await detectToolchains({
      extraBinPaths: [bin],
      env: { PATH: "" },
      exists: async (path) => found.has(path),
      readVersion: async () => "2026"
    });
    expect(toolchains[0]).toEqual(expect.objectContaining({ name: "texlive", version: "2026", binPath: bin }));
    expect(isAbsolute(toolchains[0].latexmk!)).toBe(true);
  });

  it("pins latexmk to the selected absolute engine and keeps shell escape off by default", () => {
    const runtime = {
      buildDirectory: "C:\\project\\.latex-workbench\\build\\target\\profile",
      runtimePath: "C:\\project\\runtime.tex",
      wrapperPath: "C:\\project\\wrapper.tex",
      latexmkrcPath: "C:\\project\\.latexmkrc",
      generatedEntryPath: "C:\\project\\entry.tex",
      originalEntryPath: "C:\\project\\main.tex",
      renderedStructure: "",
      warnings: []
    };
    const args = buildLatexmkArguments(runtime, "xelatex", "C:\\texlive\\2026\\bin\\windows\\xelatex.exe");
    expect(args).toContain("-pdfxe");
    expect(args).not.toContain("-shell-escape");
    expect(args.join(" ")).toContain("C:/texlive/2026/bin/windows/xelatex.exe");
    expect(buildLatexmkArguments(runtime, "xelatex", "C:\\xelatex.exe", true)).toContain("-shell-escape");
  });

  it("uses magic comments before the automatic engine fallback", () => {
    const target = {
      engine: "auto",
      classConfig: {},
      structure: [],
      profiles: [],
      packages: []
    } as unknown as DocumentTarget;
    const tools = { name: "texlive", binPath: "C:\\texlive", xelatex: "C:\\xelatex.exe" } as ToolchainInfo;
    expect(selectBuildEngine(target, tools, "% !TeX program = lualatex")).toBe("lualatex");
    expect(selectBuildEngine(target, tools, "")).toBe("xelatex");
  });

  it("does not let a manifest-selected path add an unapproved executable directory", async () => {
    const approved = join(process.cwd(), "texlive", "2026", "bin", process.platform === "win32" ? "windows" : "x86_64-linux");
    const executable = (name: string) => join(approved, process.platform === "win32" ? `${name}.exe` : name);
    const found = new Set([executable("latexmk"), executable("xelatex")]);
    const resolved = await resolveToolchain(join(process.cwd(), "untrusted", "texlive", "2026"), {
      extraBinPaths: [approved],
      env: { PATH: "" },
      exists: async (path) => found.has(path),
      readVersion: async () => "2026"
    });
    expect(resolved).toBeNull();
  });
});
