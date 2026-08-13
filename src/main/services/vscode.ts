import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { VsCodeEditor, VsCodeStatus } from "../../shared/types";

interface VsCodeInstallation {
  editor: VsCodeEditor;
  executablePath: string;
  source: "configured" | "path" | "common";
  extensionDirectory: ".vscode" | ".vscode-insiders" | ".vscode-oss";
}

const WINDOWS_EDITOR_EXECUTABLES = new Set([
  "code.exe",
  "code - insiders.exe",
  "code-insiders.exe",
  "vscodium.exe",
  "vscodium - insiders.exe"
]);

export interface VsCodeServiceOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  readDirectory?: (path: string) => string[];
  launch?: (executablePath: string, args: string[]) => Promise<void>;
  configuredExecutable?: string;
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

export function launchVsCodeProcess(executablePath: string, args: string[]): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(executablePath, args, {
      detached: false,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    let settled = false;
    let spawned = false;
    child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000); });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr?.destroy();
      if (error) rejectLaunch(error); else resolveLaunch();
    };
    const timer = setTimeout(() => {
      if (!spawned) {
        finish(new Error(`无法确认 VS Code 已启动：${executablePath}`));
        return;
      }
      child.unref();
      finish();
    }, 1_500);
    timer.unref();
    child.once("spawn", () => { spawned = true; });
    child.once("error", (error: NodeJS.ErrnoException) => {
      const reason = error.code === "ENOENT" ? "可执行文件不存在"
        : error.code === "EACCES" || error.code === "EPERM" ? "Windows 拒绝执行该文件"
          : error.message;
      finish(new Error(`无法启动 VS Code（${executablePath}）：${reason}`));
    });
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`VS Code 启动失败（退出代码 ${code ?? "未知"}）${stderr.trim() ? `：${stderr.trim()}` : "。"}`));
    });
  });
}

function installationCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): VsCodeInstallation[] {
  const candidates: VsCodeInstallation[] = [];
  const add = (
    editor: VsCodeEditor,
    executablePath: string | undefined,
    source: VsCodeInstallation["source"],
    extensionDirectory: VsCodeInstallation["extensionDirectory"] = editor === "codium" ? ".vscode-oss" : ".vscode"
  ): void => {
    if (executablePath) candidates.push({ editor, executablePath: resolve(executablePath), source, extensionDirectory });
  };

  const separator = platform === "win32" ? ";" : ":";
  const pathDirectories = (env.PATH ?? env.Path ?? "")
    .split(separator)
    .map((path) => path.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  const configured = env.VSCODE_EXECUTABLE ?? env.VSCODE_CLI;
  if (configured && /codium/i.test(basename(configured))) add("codium", configured, "configured", ".vscode-oss");
  else if (configured && /insiders/i.test(basename(configured))) add("code", configured, "configured", ".vscode-insiders");
  else add("code", configured, "configured");
  add("code", env.VSCODE_INSIDERS_EXECUTABLE, "configured", ".vscode-insiders");
  add("codium", env.VSCODIUM_EXECUTABLE, "configured", ".vscode-oss");

  for (const directory of pathDirectories) {
    if (platform === "win32") {
      add("code", join(directory, "code.exe"), "path");
      add("code", join(directory, "code-insiders.exe"), "path", ".vscode-insiders");
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
    add("code", env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "code.exe") : undefined, "common");
    add("code", env.USERPROFILE ? join(env.USERPROFILE, "scoop", "apps", "vscode", "current", "Code.exe") : undefined, "common");
    add("codium", env.USERPROFILE ? join(env.USERPROFILE, "scoop", "apps", "vscodium", "current", "VSCodium.exe") : undefined, "common");
    add("code", env.USERPROFILE ? join(env.USERPROFILE, "scoop", "apps", "vscode-insiders", "current", "Code - Insiders.exe") : undefined, "common", ".vscode-insiders");
    add("code", env.VSCODE_PORTABLE ? join(env.VSCODE_PORTABLE, "Code.exe") : undefined, "configured");
    add("code", env.VSCODE_INSIDERS_PORTABLE ? join(env.VSCODE_INSIDERS_PORTABLE, "Code - Insiders.exe") : undefined, "configured", ".vscode-insiders");
    add("codium", env.VSCODIUM_PORTABLE ? join(env.VSCODIUM_PORTABLE, "VSCodium.exe") : undefined, "configured");
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
    if (options.platform === "win32" && !WINDOWS_EDITOR_EXECUTABLES.has(basename(candidate.executablePath).toLocaleLowerCase("en-US"))) continue;
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
    join(dirname(installation.executablePath), "data", "extensions"),
    join(dirname(installation.executablePath), "..", "data", "extensions")
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
  private preferredExecutablePath: string | null = null;

  constructor(options: VsCodeServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = { ...(options.env ?? process.env) };
    this.exists = options.exists ?? existsSync;
    this.readDirectory = options.readDirectory ?? defaultReadDirectory;
    this.launch = options.launch ?? launchVsCodeProcess;
    if (options.configuredExecutable) this.setPreferredExecutablePath(options.configuredExecutable);
  }

  /**
   * Updates the user-selected editor without recreating the service. The
   * caller owns persistence; this service only validates and uses the path.
   */
  setPreferredExecutablePath(path?: string | null): VsCodeStatus {
    this.preferredExecutablePath = path?.trim() ? resolve(path.trim()) : null;
    if (this.preferredExecutablePath) this.env.VSCODE_EXECUTABLE = this.preferredExecutablePath;
    else delete this.env.VSCODE_EXECUTABLE;
    return this.status();
  }

  status(): VsCodeStatus {
    const installation = this.installation();
    const preferredUnavailable = Boolean(this.preferredExecutablePath && !this.exists(this.preferredExecutablePath));
    return {
      available: installation !== null,
      editor: installation?.editor,
      executablePath: installation?.executablePath,
      source: installation?.source,
      diagnostics: preferredUnavailable
        ? [`设置的编辑器已经移动或删除：${this.preferredExecutablePath}${installation ? `；已临时使用 ${installation.executablePath}` : ""}`]
        : installation ? undefined
          : ["未在 PATH、用户安装目录、系统安装目录、WindowsApps、Scoop 或便携版常用位置找到 VS Code。可在设置中选择 Code.exe、Code - Insiders.exe 或 VSCodium.exe。"],
      latexWorkshop: latexWorkshopStatus(installation, this.env, this.exists, this.readDirectory)
    };
  }

  async openProject(projectRoot: string): Promise<void> {
    await this.open(["--reuse-window", resolve(projectRoot)]);
  }

  async openFile(projectRoot: string, path: string, line?: number, column?: number): Promise<void> {
    const safeLine = typeof line === "number" && Number.isFinite(line)
      ? Math.max(1, Math.trunc(line))
      : undefined;
    const safeColumn = typeof column === "number" && Number.isFinite(column)
      ? Math.max(1, Math.trunc(column))
      : 1;
    await this.open(
      safeLine
        ? ["--reuse-window", "--goto", `${resolve(path)}:${safeLine}:${safeColumn}`, resolve(projectRoot)]
        : ["--reuse-window", resolve(path), resolve(projectRoot)]
    );
  }

  private installation(): VsCodeInstallation | null {
    return detectInstallation({ platform: this.platform, env: this.env, exists: this.exists });
  }

  private async open(args: string[]): Promise<void> {
    const installation = this.installation();
    if (!installation) throw new Error("未检测到 VS Code 或 VSCodium。请安装后重启客户端，或通过 VSCODE_EXECUTABLE 指定 Code.exe 路径。");
    try {
      await this.launch(installation.executablePath, args);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`编辑器启动失败。已检测到 ${installation.executablePath}，但 Windows 未确认启动成功。${detail}`);
    }
  }
}

export const ExternalEditorService = VsCodeService;
