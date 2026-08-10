import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { execFile } from "node:child_process";
import type { ToolchainInfo } from "../../shared/types";

const COMMANDS = [
  "latexmk",
  "xelatex",
  "lualatex",
  "pdflatex",
  "biber",
  "bibtex",
  "makeindex",
  "makeglossaries",
  "synctex",
  "kpsewhich"
] as const;

type ToolCommand = (typeof COMMANDS)[number];

export interface DetectedToolchainInfo extends ToolchainInfo {
  makeindex?: string;
  makeglossaries?: string;
}

export interface ToolchainDetectionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  extraBinPaths?: string[];
  exists?: (path: string) => Promise<boolean>;
  readVersion?: (command: string) => Promise<string | undefined>;
}

async function executableExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableName(command: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `${command}.exe` : command;
}

function uniquePaths(paths: Array<string | undefined>, platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  return paths.flatMap((candidate) => {
    if (!candidate) return [];
    const absolute = resolve(candidate.replace(/^"|"$/g, ""));
    const key = platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
    if (seen.has(key)) return [];
    seen.add(key);
    return [absolute];
  });
}

function standardBinPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const drive = env.SystemDrive || "C:";
    return [
      join(drive, "texlive", "2026", "bin", "windows"),
      join(drive, "texlive", "2026", "bin", "win32"),
      join(drive, "texlive", "2024", "bin", "windows"),
      join(drive, "texlive", "2024", "bin", "win32"),
      env.ProgramFiles ? join(env.ProgramFiles, "MiKTeX", "miktex", "bin", "x64") : undefined,
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "MiKTeX", "miktex", "bin", "x64") : undefined
    ].filter((value): value is string => Boolean(value));
  }

  const arch = process.arch === "arm64" ? "aarch64-linux" : "x86_64-linux";
  return [
    join("/usr/local/texlive/2026/bin", arch),
    join("/usr/local/texlive/2024/bin", arch),
    "/Library/TeX/texbin",
    "/usr/bin",
    "/usr/local/bin"
  ];
}

function inferDistribution(binPath: string): Pick<ToolchainInfo, "name" | "version"> {
  const normalizedPath = normalize(binPath);
  const texLiveMatch = normalizedPath.match(/[\\/]texlive[\\/](\d{4})(?:[\\/]|$)/i);
  if (texLiveMatch) {
    return { name: "texlive", version: texLiveMatch[1] };
  }
  if (/[\\/]miktex(?:[\\/]|$)/i.test(normalizedPath)) {
    return { name: "miktex" };
  }
  return { name: "unknown" };
}

function versionFromOutput(output: string): string | undefined {
  const texLive = output.match(/TeX Live\s+(\d{4})/i);
  if (texLive) return texLive[1];
  const latexmk = output.match(/Latexmk[^\n]*Version\s+([\d.]+)/i);
  return latexmk?.[1];
}

function defaultVersionReader(command: string): Promise<string | undefined> {
  return new Promise((resolveVersion) => {
    execFile(command, ["--version"], { windowsHide: true, timeout: 3_000, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) {
        resolveVersion(undefined);
        return;
      }
      resolveVersion(versionFromOutput(`${stdout}\n${stderr}`));
    });
  });
}

function rankToolchain(toolchain: ToolchainInfo): number {
  if (toolchain.name === "texlive" && toolchain.version === "2026") return 0;
  if (toolchain.name === "texlive" && toolchain.version === "2024") return 1;
  if (toolchain.name === "texlive") return 2;
  if (toolchain.name === "miktex") return 3;
  return 4;
}

export async function detectToolchains(options: ToolchainDetectionOptions = {}): Promise<DetectedToolchainInfo[]> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? executableExists;
  const readVersion = options.readVersion ?? defaultVersionReader;
  const pathBins = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const binPaths = uniquePaths(
    [...(options.extraBinPaths ?? []), ...standardBinPaths(platform, env), ...pathBins],
    platform
  );

  const detected: DetectedToolchainInfo[] = [];
  for (const binPath of binPaths) {
    const resolvedCommands: Partial<Record<ToolCommand, string>> = {};
    await Promise.all(
      COMMANDS.map(async (command) => {
        const candidate = join(binPath, executableName(command, platform));
        if (await exists(candidate)) resolvedCommands[command] = candidate;
      })
    );
    if (!resolvedCommands.latexmk && !resolvedCommands.xelatex && !resolvedCommands.pdflatex && !resolvedCommands.lualatex) {
      continue;
    }

    const inferred = inferDistribution(binPath);
    const versionCommand = resolvedCommands.kpsewhich ?? resolvedCommands.xelatex ?? resolvedCommands.latexmk;
    const detectedVersion = versionCommand ? await readVersion(versionCommand) : undefined;
    detected.push({
      ...inferred,
      version: inferred.version ?? detectedVersion,
      binPath,
      ...resolvedCommands
    });
  }

  return detected.sort((left, right) => rankToolchain(left) - rankToolchain(right));
}

function preferredBinCandidates(preferred: string, platform: NodeJS.Platform): string[] {
  const absolute = resolve(preferred);
  if (extname(absolute).toLowerCase() === ".exe") return [dirname(absolute)];
  const suffixes = platform === "win32"
    ? ["", join("bin", "windows"), join("bin", "win32")]
    : ["", join("bin", "x86_64-linux"), join("bin", "aarch64-linux")];
  return suffixes.map((suffix) => (suffix ? join(absolute, suffix) : absolute));
}

export async function resolveToolchain(
  preferredDistribution?: string,
  options: ToolchainDetectionOptions = {}
): Promise<DetectedToolchainInfo | null> {
  const platform = options.platform ?? process.platform;
  // A manifest is project-controlled input. It may select an already approved
  // installation, but it must never add a new executable search directory.
  const toolchains = await detectToolchains(options);
  if (!preferredDistribution) return toolchains[0] ?? null;

  const preferredKeys = new Set(preferredBinCandidates(preferredDistribution, platform).map((candidate) => {
    const absolute = resolve(candidate);
    return platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
  }));
  return toolchains.find((toolchain) => {
    const binKey = platform === "win32" ? toolchain.binPath.toLocaleLowerCase("en-US") : toolchain.binPath;
    return preferredKeys.has(binKey);
  }) ?? null;
}

export function isAbsoluteToolCommand(command: string | undefined): command is string {
  return Boolean(command && isAbsolute(command));
}

export const probeToolchains = detectToolchains;
export const listToolchains = detectToolchains;
