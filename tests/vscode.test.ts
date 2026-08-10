import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VsCodeService } from "../src/main/services/vscode";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("VS Code integration", () => {
  it("detects the Code executable behind a PATH bin directory and LaTeX Workshop", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-workbench-vscode-"));
    temporaryDirectories.push(root);
    const bin = join(root, "Microsoft VS Code", "bin");
    const executable = join(dirname(bin), "Code.exe");
    const home = join(root, "user");
    const extensions = join(home, ".vscode", "extensions");
    const found = new Set([executable, extensions]);
    const service = new VsCodeService({
      platform: "win32",
      env: { PATH: bin, USERPROFILE: home },
      exists: (path) => found.has(path),
      readDirectory: (path) => path === extensions ? ["james-yu.latex-workshop-10.9.0"] : []
    });

    expect(service.status()).toEqual({
      available: true,
      editor: "code",
      executablePath: executable,
      source: "path",
      latexWorkshop: { state: "installed", version: "10.9.0" }
    });
  });

  it("detects VSCodium from its common per-user installation path", () => {
    const localAppData = join("C:\\Users\\test", "AppData", "Local");
    const executable = join(localAppData, "Programs", "VSCodium", "VSCodium.exe");
    const service = new VsCodeService({
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: localAppData, USERPROFILE: "C:\\Users\\test" },
      exists: (path) => path === executable
    });

    expect(service.status()).toMatchObject({
      available: true,
      editor: "codium",
      executablePath: executable,
      source: "common",
      latexWorkshop: { state: "notFound" }
    });
  });

  it("checks the dedicated VS Code Insiders extension directory", () => {
    const home = "C:\\Users\\test";
    const localAppData = join(home, "AppData", "Local");
    const executable = join(localAppData, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe");
    const extensions = join(home, ".vscode-insiders", "extensions");
    const service = new VsCodeService({
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: localAppData, USERPROFILE: home },
      exists: (path) => path === executable || path === extensions,
      readDirectory: (path) => path === extensions ? ["james-yu.latex-workshop-10.10.0"] : []
    });

    expect(service.status()).toMatchObject({
      available: true,
      editor: "code",
      executablePath: executable,
      latexWorkshop: { state: "installed", version: "10.10.0" }
    });
  });

  it("launches projects and line targets as separate arguments without creating VS Code configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-workbench-vscode-"));
    temporaryDirectories.push(root);
    const project = join(root, "project with spaces");
    await mkdir(project);
    const executable = join(root, "code.exe");
    const launches: Array<{ executablePath: string; args: string[] }> = [];
    const service = new VsCodeService({
      platform: "win32",
      env: { PATH: root },
      exists: (path) => path === executable,
      launch: async (executablePath, args) => {
        launches.push({ executablePath, args: [...args] });
      }
    });

    await service.openProject(project);
    await service.openFile(project, join(project, "chapters", "chapter one.tex"), 12.9);
    await service.openFile(project, join(project, "main.tex"));

    expect(launches).toEqual([
      { executablePath: executable, args: ["--reuse-window", project] },
      {
        executablePath: executable,
        args: ["--reuse-window", project, "--goto", `${join(project, "chapters", "chapter one.tex")}:12`]
      },
      {
        executablePath: executable,
        args: ["--reuse-window", project, join(project, "main.tex")]
      }
    ]);
    await expect(stat(join(project, ".vscode"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports an unavailable editor instead of falling back to a shell command", async () => {
    const service = new VsCodeService({
      platform: "win32",
      env: { PATH: "" },
      exists: () => false
    });

    expect(service.status()).toEqual({ available: false, latexWorkshop: { state: "unknown" } });
    await expect(service.openProject("C:\\project")).rejects.toThrow("VS Code or VSCodium was not found");
  });
});
