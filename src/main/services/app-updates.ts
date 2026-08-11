import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { AppUpdateSettings, AppUpdateStatus } from "../../shared/types";

const UPDATE_REPOSITORY = "Ararataki-number-one/latex-project-manager";
const RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;
const SETTINGS_VERSION = 1;
const DEFAULT_SETTINGS: AppUpdateSettings = { autoCheck: true, autoDownload: true };

interface UpdateCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type UpdateCommandRunner = (
  executable: string,
  cwd: string,
  args: string[],
  timeoutMs: number
) => Promise<UpdateCommandResult>;

interface GitHubReleaseAsset {
  name: string;
  size: number;
  digest?: string;
  url?: string;
}

interface GitHubRelease {
  tagName: string;
  name?: string;
  url: string;
  publishedAt?: string;
  isDraft?: boolean;
  isPrerelease?: boolean;
  assets: GitHubReleaseAsset[];
}

interface StoredUpdateSettings extends AppUpdateSettings {
  schemaVersion: typeof SETTINGS_VERSION;
}

export interface AppUpdateServiceOptions {
  currentVersion: string;
  env?: NodeJS.ProcessEnv;
  ghExecutable?: string;
  runner?: UpdateCommandRunner;
}

function defaultRunner(executable: string, cwd: string, args: string[], timeoutMs: number): Promise<UpdateCommandResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        LC_ALL: "C",
        LANG: "C"
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString("utf8")}`.slice(0, 2_000_000);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectRun(new Error("检查更新超时，请稍后重试。"));
    }, timeoutMs);
    timer.unref();
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ code: code ?? -1, stdout, stderr });
    });
  });
}

function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Release 版本号格式无效。");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function conciseError(result: UpdateCommandResult): string {
  const raw = (result.stderr || result.stdout || `GitHub CLI exited with code ${result.code}`).trim();
  if (/auth|login|http 401|http 403/i.test(raw)) {
    return "私有仓库需要 GitHub 登录。请先打开 GitHub Desktop 或 GitHub CLI 完成登录。";
  }
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

async function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

export class AppUpdateService {
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: UpdateCommandRunner;
  private ghExecutable: string | null | undefined;
  private release: GitHubRelease | null = null;
  private asset: GitHubReleaseAsset | null = null;
  private job: Promise<AppUpdateStatus> | null = null;
  private live: Partial<AppUpdateStatus> = { state: "idle" };

  constructor(private readonly directory: string, private readonly options: AppUpdateServiceOptions) {
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? defaultRunner;
    if (options.ghExecutable) this.ghExecutable = options.ghExecutable;
  }

  async status(): Promise<AppUpdateStatus> {
    const settings = await this.readSettings();
    const executable = await this.resolveGh();
    return {
      currentVersion: this.options.currentVersion,
      autoCheck: settings.autoCheck,
      autoDownload: settings.autoDownload,
      state: executable ? (this.live.state ?? "idle") : "unavailable",
      githubCliAvailable: Boolean(executable),
      releaseUrl: this.live.releaseUrl ?? RELEASES_URL,
      latestVersion: this.live.latestVersion,
      releaseName: this.live.releaseName,
      publishedAt: this.live.publishedAt,
      downloadedPath: this.live.downloadedPath,
      checkedAt: this.live.checkedAt,
      message: executable
        ? (this.live.message ?? "尚未检查更新。")
        : "未检测到 GitHub CLI；仍可在浏览器中手动下载更新。"
    };
  }

  async setSettings(settings: AppUpdateSettings): Promise<AppUpdateStatus> {
    if (!settings || typeof settings.autoCheck !== "boolean" || typeof settings.autoDownload !== "boolean") {
      throw new Error("自动更新设置无效。");
    }
    await this.writeSettings({ schemaVersion: SETTINGS_VERSION, ...settings });
    return this.status();
  }

  async check(downloadIfAvailable = false): Promise<AppUpdateStatus> {
    if (this.job) return this.job;
    const job = this.performCheck(downloadIfAvailable).finally(() => { this.job = null; });
    this.job = job;
    return job;
  }

  async checkAutomatically(): Promise<AppUpdateStatus> {
    const settings = await this.readSettings();
    if (!settings.autoCheck) return this.status();
    return this.check(settings.autoDownload);
  }

  async download(): Promise<AppUpdateStatus> {
    if (this.job) return this.job;
    const job = this.performDownload().finally(() => { this.job = null; });
    this.job = job;
    return job;
  }

  async downloadedInstaller(): Promise<string> {
    const path = this.live.downloadedPath;
    if (!path || this.live.state !== "downloaded") throw new Error("请先下载可用更新。");
    const canonicalDirectory = resolve(this.directory);
    const canonicalPath = resolve(path);
    if (!isInside(canonicalDirectory, canonicalPath) || !canonicalPath.toLocaleLowerCase("en-US").endsWith(".exe")) {
      throw new Error("更新安装包路径无效。");
    }
    const metadata = await stat(canonicalPath);
    if (!metadata.isFile()) throw new Error("更新安装包已经不存在，请重新下载。");
    return canonicalPath;
  }

  private async performCheck(downloadIfAvailable: boolean): Promise<AppUpdateStatus> {
    await mkdir(this.directory, { recursive: true });
    this.live = { ...this.live, state: "checking", message: "正在检查 GitHub Release…" };
    const executable = await this.resolveGh();
    if (!executable) return this.status();
    try {
      const result = await this.runner(executable, this.directory, [
        "release", "view", "--repo", UPDATE_REPOSITORY,
        "--json", "tagName,name,url,publishedAt,isDraft,isPrerelease,assets"
      ], 120_000);
      if (result.code !== 0) throw new Error(conciseError(result));
      const release = JSON.parse(result.stdout) as GitHubRelease;
      if (!release || typeof release.tagName !== "string" || typeof release.url !== "string" || !Array.isArray(release.assets)
        || release.isDraft || release.isPrerelease) {
        throw new Error("GitHub 返回的 Release 信息无效。");
      }
      const latestVersion = release.tagName.replace(/^v/i, "");
      const checkedAt = new Date().toISOString();
      const relation = compareVersions(latestVersion, this.options.currentVersion);
      this.release = release;
      this.asset = this.selectWindowsAsset(release.assets);
      if (relation <= 0) {
        this.live = {
          state: "upToDate",
          latestVersion,
          releaseName: release.name,
          releaseUrl: release.url,
          publishedAt: release.publishedAt,
          checkedAt,
          message: `当前已是最新版本 ${this.options.currentVersion}。`
        };
        return this.status();
      }
      if (!this.asset) throw new Error("最新 Release 中没有找到 Windows 安装包。");
      this.live = {
        state: "available",
        latestVersion,
        releaseName: release.name,
        releaseUrl: release.url,
        publishedAt: release.publishedAt,
        checkedAt,
        message: `发现新版本 ${latestVersion}。`
      };
      return downloadIfAvailable ? this.performDownload() : this.status();
    } catch (error) {
      this.live = {
        ...this.live,
        state: "error",
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "检查更新失败。"
      };
      return this.status();
    }
  }

  private async performDownload(): Promise<AppUpdateStatus> {
    if (!this.release || !this.asset) {
      const checked = await this.performCheck(false);
      if (checked.state !== "available" || !this.release || !this.asset) return checked;
    }
    const executable = await this.resolveGh();
    if (!executable) return this.status();
    const release = this.release;
    const asset = this.asset;
    if (basename(asset.name) !== asset.name || !asset.name.toLocaleLowerCase("en-US").endsWith(".exe")) {
      throw new Error("Release 安装包名称无效。");
    }
    const version = release.tagName.replace(/^v/i, "");
    const destinationDirectory = resolve(this.directory, version);
    if (!isInside(resolve(this.directory), destinationDirectory)) throw new Error("更新目录无效。");
    await mkdir(destinationDirectory, { recursive: true });
    const destination = resolve(destinationDirectory, asset.name);
    const expected = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? "")?.[1];
    try {
      const existing = await stat(destination);
      const sizeMatches = existing.isFile() && (!Number.isFinite(asset.size) || asset.size <= 0 || existing.size === asset.size);
      const digestMatches = !expected || (sizeMatches && (await sha256(destination)).toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US"));
      if (sizeMatches && digestMatches) {
        this.live = { ...this.live, state: "downloaded", downloadedPath: destination, message: `版本 ${version} 已下载，可以安装。` };
        return this.status();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.live = { ...this.live, state: "downloading", message: `正在下载 ${version}…` };
    try {
      const result = await this.runner(executable, this.directory, [
        "release", "download", release.tagName, "--repo", UPDATE_REPOSITORY,
        "--pattern", asset.name, "--dir", destinationDirectory, "--clobber"
      ], 15 * 60_000);
      if (result.code !== 0) throw new Error(conciseError(result));
      const metadata = await stat(destination);
      if (!metadata.isFile() || (Number.isFinite(asset.size) && asset.size > 0 && metadata.size !== asset.size)) {
        await rm(destination, { force: true });
        throw new Error("更新安装包大小校验失败，请重新下载。");
      }
      if (expected && (await sha256(destination)).toLocaleLowerCase("en-US") !== expected.toLocaleLowerCase("en-US")) {
        await rm(destination, { force: true });
        throw new Error("更新安装包完整性校验失败，请重新下载。");
      }
      this.live = { ...this.live, state: "downloaded", downloadedPath: destination, message: `版本 ${version} 已下载，可以安装。` };
      return this.status();
    } catch (error) {
      this.live = { ...this.live, state: "error", message: error instanceof Error ? error.message : "下载更新失败。" };
      return this.status();
    }
  }

  private selectWindowsAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
    const executables = assets.filter((asset) => typeof asset.name === "string" && asset.name.toLocaleLowerCase("en-US").endsWith(".exe"));
    return executables.find((asset) => /setup|installer|安装/i.test(asset.name))
      ?? executables.find((asset) => !/portable|便携/i.test(asset.name))
      ?? executables[0]
      ?? null;
  }

  private async resolveGh(): Promise<string | null> {
    if (this.ghExecutable !== undefined) return this.ghExecutable;
    await mkdir(this.directory, { recursive: true });
    const programFiles = this.env.ProgramFiles;
    const localAppData = this.env.LOCALAPPDATA;
    const candidates = [
      this.env.GH_EXECUTABLE,
      programFiles ? join(programFiles, "GitHub CLI", "gh.exe") : undefined,
      localAppData ? join(localAppData, "Programs", "GitHub CLI", "gh.exe") : undefined,
      "gh"
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      if (isAbsolute(candidate) && !existsSync(candidate)) continue;
      try {
        const result = await this.runner(candidate, this.directory, ["--version"], 15_000);
        if (result.code === 0 && /^gh version /i.test(result.stdout.trim())) {
          this.ghExecutable = candidate;
          return candidate;
        }
      } catch {
        // Try the next known installation.
      }
    }
    this.ghExecutable = null;
    return null;
  }

  private settingsPath(): string {
    return join(this.directory, "settings.json");
  }

  private async readSettings(): Promise<AppUpdateSettings> {
    try {
      const value = JSON.parse(await readFile(this.settingsPath(), "utf8")) as Partial<StoredUpdateSettings>;
      if (value.schemaVersion !== SETTINGS_VERSION || typeof value.autoCheck !== "boolean" || typeof value.autoDownload !== "boolean") {
        return DEFAULT_SETTINGS;
      }
      return { autoCheck: value.autoCheck, autoDownload: value.autoDownload };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return DEFAULT_SETTINGS;
      throw error;
    }
  }

  private async writeSettings(settings: StoredUpdateSettings): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.settingsPath();
    const temporary = `${path}.${randomBytes(5).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }
}
