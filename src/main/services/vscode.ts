import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { VsCodeEditor, VsCodeStatus } from "../../shared/types";

interface VsCodeInstallation {
  editor: VsCodeEditor;
  executablePath: string;
  source: "path" | "common";
  extensionDirectory: ".vscode" | ".vscode-insiders" | ".vscode-oss";
}

export interface VsCodeServiceOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  readDirectory?: (path: string) => string[];
  launch?: (executablePath: string, args: string[]) => Promise<void>;
}

function defaultReadDirectory(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function launchDetached(executablePath: string, args: string[]): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(executablePath, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", rejectLaunch);
    child.once("spawn", () => {
      child.unref();
      resolveLaunch();
    });
  });
}

function installationCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): VsCodeInstallation[] {
  const candidates: VsCodeInstallation[] = [];
  const add = (
    editor: VsCodeEditor,
    executablePath: string | undefined,
    source: "path" | "common",
    extensionDirectory: VsCodeInstallation["extensionDirectory"] = editor === "codium" ? ".vscode-oss" : ".vscode"
  ): void => {
    if (executablePath) candidates.push({ editor, executablePath: resolve(executablePath), source, extensionDirectory });
  };

  const separator = platform === "win32" ? ";" : ":";
  const pathDirectories = (env.PATH ?? env.Path ?? "")
    .split(separator)
    .map((path) => path.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  for (const directory of pathDirectories) {
    if (platform === "win32") {
      add("code", join(directory, "code.exe"), "path");
      add("codium", join(directory, "codium.exe"), "path");
      if (basename(directory).toLowerCase() === "bin") {
        add("code", join(dirname(directory), "Code.exe"), "path");
        add("code", join(dirname(directory), "Code - Insiders.exe"), "path", ".vscode-insiders");
        add("codium", join(dirname(directory), "VSCodium.exe"), "path");
      }
    } else {
      add("code", join(directory, "code"), "path");
      add("codium", join(directory, "codium"), "path");
    }
  }

  if (platform === "win32") {
    const programFilesX86 = env["ProgramFiles(x86)"];
    add("code", env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe") : undefined, "common");
    add("code", env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe") : undefined, "common", ".vscode-insiders");
    add("code", env.ProgramFiles ? join(env.ProgramFiles, "Microsoft VS Code", "Code.exe") : undefined, "common");
    add("code", programFilesX86 ? join(programFilesX86, "Microsoft VS Code", "Code.exe") : undefined, "common");
    add("codium", env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "VSCodium", "VSCodium.exe") : undefined, "common");
    add("codium", env.ProgramFiles ? join(env.ProgramFiles, "VSCodium", "VSCodium.exe") : undefined, "common");
    add("codium", programFilesX86 ? join(programFilesX86, "VSCodium", "VSCodium.exe") : undefined, "common");
    add("code", join(env.SystemDrive || "C:", "vscode", "Microsoft VS Code", "Code.exe"), "common");
  } else if (platform === "darwin") {
    add("code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", "common");
    add("codium", "/Applications/VSCodium.app/Contents/Resources/app/bin/codium", "common");
  }

  return candidates;
}

function detectInstallation(options: Required<Pick<VsCodeServiceOptions, "platform" | "env" | "exists">>): VsCodeInstallation | null {
  const seen = new Set<string>();
  for (const candidate of installationCandidates(options.platform, options.env)) {
    const key = options.platform === "win32"
      ? candidate.executablePath.toLocaleLowerCase("en-US")
      : candidate.executablePath;
    if (seen.has(key)) continue;
    seen.add(key);
    if (options.exists(candidate.executablePath)) return candidate;
  }
  return null;
}

function latexWorkshopStatus(
  installation: VsCodeInstallation | null,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
  readDirectory: (path: string) => string[]
): VsCodeStatus["latexWorkshop"] {
  if (!installation) return { state: "unknown" };

  const home = env.USERPROFILE ?? env.HOME;
  const roots = [
    env.VSCODE_EXTENSIONS,
    home ? join(home, installation.extensionDirectory, "extensions") : undefined,
    join(dirname(installation.executablePath), "data", "extensions")
  ].filter((path): path is string => Boolean(path));
  const prefix = "james-yu.latex-workshop-";
  const versions: string[] = [];
  for (const root of roots) {
    if (!exists(root)) continue;
    for (const name of readDirectory(root)) {
      if (name.toLowerCase().startsWith(prefix)) versions.push(name.slice(prefix.length));
    }
  }
  versions.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return versions[0] ? { state: "installed", version: versions[0] } : { state: "notFound" };
}

export class VsCodeService {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly exists: (path: string) => boolean;
  private readonly readDirectory: (path: string) => string[];
  private readonly launch: (executablePath: string, args: string[]) => Promise<void>;

  constructor(options: VsCodeServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.exists = options.exists ?? existsSync;
    this.readDirectory = options.readDirectory ?? defaultReadDirectory;
    this.launch = options.launch ?? launchDetached;
  }

  status(): VsCodeStatus {
    const installation = this.installation();
    return {
      available: installation !== null,
      editor: installation?.editor,
      executablePath: installation?.executablePath,
      source: installation?.source,
      latexWorkshop: latexWorkshopStatus(installation, this.env, this.exists, this.readDirectory)
    };
  }

  async openProject(projectRoot: string): Promise<void> {
    await this.open(["--reuse-window", projectRoot]);
  }

  async openFile(projectRoot: string, path: string, line?: number): Promise<void> {
    const safeLine = typeof line === "number" && Number.isFinite(line)
      ? Math.max(1, Math.trunc(line))
      : undefined;
    await this.open(
      safeLine
        ? ["--reuse-window", projectRoot, "--goto", `${path}:${safeLine}`]
        : ["--reuse-window", projectRoot, path]
    );
  }

  private installation(): VsCodeInstallation | null {
    return detectInstallation({ platform: this.platform, env: this.env, exists: this.exists });
  }

  private async open(args: string[]): Promise<void> {
    const installation = this.installation();
    if (!installation) throw new Error("VS Code or VSCodium was not found.");
    await this.launch(installation.executablePath, args);
  }
}

export const ExternalEditorService = VsCodeService;
