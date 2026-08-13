import { createHash, randomBytes, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

import type { AppUpdateSettings, AppUpdateStatus } from "../../shared/types";
import { RELEASE_MANIFEST_PUBLIC_KEY_PEM } from "../../shared/release-public-key";

const UPDATE_REPOSITORY = "Ararataki-number-one/latex-project-manager";
const RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;
const RELEASE_MANIFEST_NAME = "release-manifest.json";
const RELEASE_KEY_ID = "latex-project-manager-release-ed25519-v1";
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

export interface UpdateDownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
}

export type UpdateAssetDownloader = (
  url: string,
  destination: string,
  options: {
    expectedSize: number;
    resumeFrom: number;
    signal: AbortSignal;
    onProgress: (progress: UpdateDownloadProgress) => void;
  }
) => Promise<void>;

export type WindowsUpdateInstallMode = "installed" | "portable";

export interface UpdateInstallerLaunch {
  path: string;
  mode: WindowsUpdateInstallMode;
}

export type UpdateInstallerLauncher = (path: string, mode: WindowsUpdateInstallMode) => Promise<void>;

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

export type SignedReleaseAssetKind = "windows-setup" | "windows-portable" | "android-apk";

export interface SignedReleaseAsset {
  kind: SignedReleaseAssetKind;
  name: string;
  size: number;
  sha256: string;
  certificateSha256?: string;
}

export interface SignedReleaseManifest {
  signed: {
    schemaVersion: 1;
    keyId: string;
    version: string;
    tag: string;
    generatedAt: string;
    assets: SignedReleaseAsset[];
  };
  payload: string;
  signature: {
    algorithm: "Ed25519";
    keyId: string;
    value: string;
  };
}

interface StoredUpdateSettings extends AppUpdateSettings {
  schemaVersion: typeof SETTINGS_VERSION;
}

interface StoredUpdateState extends Partial<AppUpdateStatus> {
  partialPath?: string;
}

export interface AppUpdateServiceOptions {
  currentVersion: string;
  releaseChannel?: "stable" | "beta";
  env?: NodeJS.ProcessEnv;
  ghExecutable?: string;
  runner?: UpdateCommandRunner;
  publicKeyPem?: string | Buffer;
  publisherVerifier?: (path: string, expectedCertificateSha256: string) => Promise<boolean>;
  downloader?: UpdateAssetDownloader;
  installerLauncher?: UpdateInstallerLauncher;
  installMode?: WindowsUpdateInstallMode;
  onStatus?: (status: AppUpdateStatus) => void;
}

interface GitHubApiAsset {
  name: string;
  size: number;
  digest?: string;
  browser_download_url: string;
}

interface GitHubApiRelease {
  tag_name: string;
  name?: string;
  html_url: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: GitHubApiAsset[];
}

function allowedDownloadUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLocaleLowerCase("en-US");
  const allowed = host === "github.com" || host === "api.github.com"
    || host === "objects.githubusercontent.com" || host === "release-assets.githubusercontent.com"
    || host.endsWith(".githubusercontent.com");
  if (url.protocol !== "https:" || !allowed || url.username || url.password) {
    throw new Error("更新下载地址不受信任，已停止下载。");
  }
  return url;
}

function abortError(): Error {
  const error = new Error("更新下载已取消。");
  error.name = "AbortError";
  return error;
}

async function defaultDownloader(
  initialUrl: string,
  destination: string,
  options: Parameters<UpdateAssetDownloader>[2]
): Promise<void> {
  const download = async (value: string, redirects: number): Promise<void> => {
    if (redirects > 6) throw new Error("更新下载重定向次数过多。");
    if (options.signal.aborted) throw abortError();
    const url = allowedDownloadUrl(value);
    await new Promise<void>((resolveDownload, rejectDownload) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener("abort", cancel);
        if (error) rejectDownload(error);
        else resolveDownload();
      };
      const headers: Record<string, string> = {
        Accept: "application/octet-stream",
        "User-Agent": "LaTeX-Project-Manager-Updater"
      };
      if (options.resumeFrom > 0) headers.Range = `bytes=${options.resumeFrom}-`;
      const req = request(url, { method: "GET", headers }, (response) => {
        const statusCode = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = response.headers.location;
          response.resume();
          if (!location) { finish(new Error("更新下载重定向缺少目标地址。")); return; }
          settled = true;
          options.signal.removeEventListener("abort", cancel);
          void download(new URL(location, url).href, redirects + 1).then(resolveDownload, rejectDownload);
          return;
        }
        if (statusCode !== 200 && statusCode !== 206) {
          response.resume();
          finish(new Error(`更新服务器返回 HTTP ${statusCode}。`));
          return;
        }
        const resumed = statusCode === 206 && options.resumeFrom > 0;
        if (resumed) {
          const match = /^bytes\s+(\d+)-/i.exec(String(response.headers["content-range"] ?? ""));
          if (!match || Number.parseInt(match[1], 10) !== options.resumeFrom) {
            response.resume();
            finish(new Error("服务器返回的断点位置不一致，请重试下载。"));
            return;
          }
        }
        let downloadedBytes = resumed ? options.resumeFrom : 0;
        const stream = createWriteStream(destination, { flags: resumed ? "a" : "w", mode: 0o600 });
        response.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes > options.expectedSize) {
            response.destroy(new Error("更新安装包超过签名清单声明的大小。"));
            return;
          }
          options.onProgress({ downloadedBytes, totalBytes: options.expectedSize });
        });
        void pipeline(response, stream).then(() => finish(), finish);
      });
      const cancel = (): void => { req.destroy(abortError()); };
      options.signal.addEventListener("abort", cancel, { once: true });
      req.setTimeout(30_000, () => { req.destroy(new Error("更新下载连接超时。")); });
      req.once("error", finish);
      req.end();
    });
  };
  await download(initialUrl, 0);
}

async function downloadBuffer(initialUrl: string, signal?: AbortSignal, maximumBytes = 2_000_000): Promise<Buffer> {
  const read = async (value: string, redirects: number): Promise<Buffer> => {
    if (redirects > 6) throw new Error("GitHub 响应重定向次数过多。");
    if (signal?.aborted) throw abortError();
    const url = allowedDownloadUrl(value);
    return new Promise<Buffer>((resolveBuffer, rejectBuffer) => {
      const req = request(url, {
        method: "GET",
        headers: { Accept: "application/vnd.github+json", "User-Agent": "LaTeX-Project-Manager-Updater", "X-GitHub-Api-Version": "2022-11-28" }
      }, (response) => {
        const statusCode = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = response.headers.location;
          response.resume();
          if (!location) { rejectBuffer(new Error("GitHub 响应缺少重定向地址。")); return; }
          void read(new URL(location, url).href, redirects + 1).then(resolveBuffer, rejectBuffer);
          return;
        }
        if (statusCode !== 200) {
          response.resume();
          rejectBuffer(new Error(statusCode === 403 ? "GitHub 暂时限制了更新检查，请稍后重试。" : `GitHub 更新服务返回 HTTP ${statusCode}。`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximumBytes) response.destroy(new Error("GitHub 更新响应异常过大。"));
          else chunks.push(chunk);
        });
        response.once("end", () => resolveBuffer(Buffer.concat(chunks)));
        response.once("error", rejectBuffer);
      });
      const cancel = (): void => { req.destroy(abortError()); };
      signal?.addEventListener("abort", cancel, { once: true });
      req.setTimeout(30_000, () => { req.destroy(new Error("GitHub 更新检查超时。")); });
      req.once("error", rejectBuffer);
      req.end();
    });
  };
  return read(initialUrl, 0);
}

function mapApiRelease(release: GitHubApiRelease): GitHubRelease {
  return {
    tagName: release.tag_name,
    name: release.name,
    url: release.html_url,
    publishedAt: release.published_at,
    isDraft: release.draft,
    isPrerelease: release.prerelease,
    assets: Array.isArray(release.assets) ? release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
      url: asset.browser_download_url
    })) : []
  };
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
    killer.unref();
  } else {
    child.kill("SIGTERM");
  }
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
      terminateProcessTree(child);
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

interface ParsedVersion {
  core: number[];
  prerelease: "beta" | "rc" | null;
  prereleaseNumber: number | null;
}

export function detectWindowsUpdateInstallMode(env: NodeJS.ProcessEnv = process.env): WindowsUpdateInstallMode {
  return env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_APP_FILENAME
    ? "portable"
    : "installed";
}

/**
 * Starts the verified installer without a shell and resolves only after the OS
 * has acknowledged the process. An immediate non-zero exit is treated as a
 * launch failure, so callers must not quit the application in that case.
 */
export function launchUpdateInstallerProcess(path: string): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(path, [], {
      detached: true,
      shell: false,
      windowsHide: false,
      stdio: "ignore"
    });
    let spawned = false;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectLaunch(error);
      else resolveLaunch();
    };
    const timer = setTimeout(() => {
      if (!spawned) {
        finish(new Error("Windows 未确认更新安装器已经启动。"));
        return;
      }
      child.unref();
      finish();
    }, 1_200);
    timer.unref();
    child.once("spawn", () => { spawned = true; });
    child.once("error", (error: NodeJS.ErrnoException) => {
      const reason = error.code === "ENOENT" ? "安装器文件不存在"
        : error.code === "EACCES" || error.code === "EPERM" ? "Windows 拒绝执行安装器"
          : error.message;
      finish(new Error(`无法启动更新安装器：${reason}`));
    });
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`更新安装器启动后立即失败（退出代码 ${code ?? "未知"}）。`));
    });
  });
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?$/.exec(value.trim());
  return match ? {
    core: match.slice(1, 4).map((part) => Number.parseInt(part, 10)),
    prerelease: match[4] === undefined ? null : match[4] as "beta" | "rc",
    prereleaseNumber: match[5] === undefined ? null : Number.parseInt(match[5], 10)
  } : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Release 版本号格式无效。");
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease === null && b.prerelease !== null) return 1;
  if (a.prerelease !== null && b.prerelease === null) return -1;
  if (a.prerelease !== b.prerelease) {
    const rank = (value: ParsedVersion["prerelease"]) => value === "rc" ? 2 : value === "beta" ? 1 : 3;
    return rank(a.prerelease) > rank(b.prerelease) ? 1 : -1;
  }
  if (a.prereleaseNumber !== b.prereleaseNumber) {
    return (a.prereleaseNumber ?? 0) > (b.prereleaseNumber ?? 0) ? 1 : -1;
  }
  return 0;
}

function betaReleaseTag(output: string): string {
  const releases = JSON.parse(output) as Array<Pick<GitHubRelease, "tagName" | "isDraft" | "isPrerelease">>;
  if (!Array.isArray(releases)) throw new Error("GitHub 返回的 Beta Release 列表无效。");
  const candidates = releases.filter((release) => release && !release.isDraft && release.isPrerelease
    && /^v?\d+\.\d+\.\d+-beta\.\d+$/.test(release.tagName));
  candidates.sort((left, right) => compareVersions(right.tagName, left.tagName));
  if (!candidates[0]) throw new Error("尚未找到可用的 Beta Release。");
  return candidates[0].tagName;
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

function normalizedFingerprint(value: string): string {
  return value.replace(/[^a-f0-9]/gi, "").toLocaleLowerCase("en-US");
}

function validateManifest(
  raw: unknown,
  release: GitHubRelease,
  publicKeyPem: string | Buffer
): SignedReleaseManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("签名发布清单格式无效。");
  const manifest = raw as Partial<SignedReleaseManifest>;
  const displayedSigned = manifest.signed;
  const signature = manifest.signature;
  if (!displayedSigned || typeof manifest.payload !== "string"
    || !signature || signature.algorithm !== "Ed25519" || signature.keyId !== RELEASE_KEY_ID
    || typeof signature.value !== "string") {
    throw new Error("签名发布清单缺少必要字段。");
  }
  const payloadBytes = Buffer.from(manifest.payload, "base64");
  let signed: SignedReleaseManifest["signed"];
  try {
    signed = JSON.parse(payloadBytes.toString("utf8")) as SignedReleaseManifest["signed"];
  } catch {
    throw new Error("签名发布清单载荷不是有效 JSON。");
  }
  if (!signed || signed.schemaVersion !== 1 || signed.keyId !== RELEASE_KEY_ID
    || typeof signed.version !== "string" || typeof signed.tag !== "string"
    || typeof signed.generatedAt !== "string" || !Array.isArray(signed.assets)) {
    throw new Error("签名发布清单载荷格式无效。");
  }
  if (signed.tag !== release.tagName || signed.version !== release.tagName.replace(/^v/i, "")) {
    throw new Error("发布清单版本与 GitHub Release 不一致。");
  }
  const signatureBytes = Buffer.from(signature.value, "base64");
  if (signatureBytes.length !== 64
    || !verify(null, payloadBytes, publicKeyPem, signatureBytes)) {
    throw new Error("发布清单签名验证失败，已拒绝自动更新。");
  }
  const releaseAssets = new Map(release.assets.map((asset) => [asset.name, asset]));
  const seenKinds = new Set<string>();
  const seenNames = new Set<string>();
  for (const asset of signed.assets) {
    if (!asset || !new Set(["windows-setup", "windows-portable", "android-apk"]).has(asset.kind)
      || basename(asset.name) !== asset.name || seenKinds.has(asset.kind) || seenNames.has(asset.name)
      || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^[a-f0-9]{64}$/i.test(asset.sha256)
      || (asset.certificateSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(normalizedFingerprint(asset.certificateSha256)))) {
      throw new Error("发布清单中的资产信息无效或重复。");
    }
    seenKinds.add(asset.kind);
    seenNames.add(asset.name);
    const releaseAsset = releaseAssets.get(asset.name);
    if (!releaseAsset || releaseAsset.size !== asset.size) throw new Error(`Release 资产与签名清单不一致：${asset.name}`);
    const githubDigest = /^sha256:([a-f0-9]{64})$/i.exec(releaseAsset.digest ?? "")?.[1];
    if (githubDigest && githubDigest.toLocaleLowerCase("en-US") !== asset.sha256.toLocaleLowerCase("en-US")) {
      throw new Error(`Release 资产摘要与签名清单不一致：${asset.name}`);
    }
  }
  return { ...(manifest as SignedReleaseManifest), signed };
}

async function defaultPublisherVerifier(path: string, expectedCertificateSha256: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  return new Promise((resolveVerification) => {
    const script = "$s=Get-AuthenticodeSignature -LiteralPath $args[0]; if($s.Status -ne 'Valid' -or -not $s.SignerCertificate){exit 2}; $h=[Security.Cryptography.SHA256]::Create(); try{$b=$h.ComputeHash($s.SignerCertificate.RawData); [Console]::Out.Write(([BitConverter]::ToString($b)).Replace('-',''))}finally{$h.Dispose()}";
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, path], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", () => resolveVerification(false));
    child.once("close", (code) => resolveVerification(
      code === 0 && normalizedFingerprint(output) === normalizedFingerprint(expectedCertificateSha256)
    ));
  });
}

export class AppUpdateService {
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: UpdateCommandRunner;
  private readonly publicKeyPem: string | Buffer;
  private readonly publisherVerifier: (path: string, expectedCertificateSha256: string) => Promise<boolean>;
  private readonly downloader: UpdateAssetDownloader;
  private readonly installerLauncher: UpdateInstallerLauncher;
  private readonly installMode: WindowsUpdateInstallMode;
  private ghExecutable: string | null | undefined;
  private release: GitHubRelease | null = null;
  private manifest: SignedReleaseManifest | null = null;
  private asset: SignedReleaseAsset | null = null;
  private job: Promise<AppUpdateStatus> | null = null;
  private live: Partial<AppUpdateStatus> = { state: "idle" };
  private abortController: AbortController | null = null;
  private restored = false;
  private persistQueue: Promise<void> = Promise.resolve();
  private lastProgressAt = 0;
  private lastProgressPersistAt = 0;
  private partialPath: string | null = null;

  constructor(private readonly directory: string, private readonly options: AppUpdateServiceOptions) {
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? defaultRunner;
    this.publicKeyPem = options.publicKeyPem ?? RELEASE_MANIFEST_PUBLIC_KEY_PEM;
    this.publisherVerifier = options.publisherVerifier ?? defaultPublisherVerifier;
    this.downloader = options.downloader ?? defaultDownloader;
    this.installerLauncher = options.installerLauncher ?? ((path) => launchUpdateInstallerProcess(path));
    this.installMode = options.installMode ?? detectWindowsUpdateInstallMode(this.env);
    if (options.ghExecutable) this.ghExecutable = options.ghExecutable;
  }

  async status(): Promise<AppUpdateStatus> {
    await this.restoreState();
    await this.persistQueue;
    const settings = await this.readSettings();
    const executable = await this.resolveGh();
    return {
      currentVersion: this.options.currentVersion,
      autoCheck: settings.autoCheck,
      autoDownload: settings.autoDownload,
      state: this.live.state ?? "idle",
      githubCliAvailable: Boolean(executable),
      releaseUrl: this.live.releaseUrl ?? RELEASES_URL,
      latestVersion: this.live.latestVersion,
      releaseName: this.live.releaseName,
      publishedAt: this.live.publishedAt,
      downloadedPath: this.live.downloadedPath,
      downloadedBytes: this.live.downloadedBytes,
      totalBytes: this.live.totalBytes,
      progressPercent: this.live.progressPercent,
      phase: this.live.phase,
      canCancel: this.live.state === "downloading",
      canRetry: this.live.state === "error" || this.live.state === "cancelled",
      checkedAt: this.live.checkedAt,
      message: this.live.message ?? "尚未检查更新；更新功能不需要安装 GitHub CLI。"
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
    await this.restoreState();
    if (this.job) return this.job;
    const job = this.performCheck(downloadIfAvailable).finally(() => { this.job = null; });
    this.job = job;
    return job;
  }

  async checkAutomatically(): Promise<AppUpdateStatus> {
    await this.restoreState();
    const settings = await this.readSettings();
    if (!settings.autoCheck) return this.status();
    return this.check(settings.autoDownload);
  }

  async download(): Promise<AppUpdateStatus> {
    await this.restoreState();
    if (this.job) return this.job;
    const job = this.performDownload().finally(() => { this.job = null; });
    this.job = job;
    return job;
  }

  async cancel(): Promise<AppUpdateStatus> {
    await this.restoreState();
    if (this.live.state !== "downloading" || !this.abortController) return this.status();
    this.abortController.abort();
    this.setLive({
      state: "cancelled",
      phase: "cancelled",
      canCancel: false,
      canRetry: true,
      message: "更新下载已取消；已下载的部分会保留，稍后可继续。"
    }, true);
    return this.status();
  }

  async downloadedInstaller(): Promise<string> {
    await this.restoreState();
    const path = this.live.downloadedPath;
    if (!path || this.live.state !== "downloaded") throw new Error("请先下载可用更新。");
    if (!this.asset) {
      const rememberedPath = path;
      const checked = await this.performCheck(false);
      if (checked.state !== "available" || !this.asset) throw new Error("无法重新验证已下载的更新，请重新检查更新。");
      this.live.downloadedPath = rememberedPath;
    }
    const canonicalDirectory = resolve(this.directory);
    const canonicalPath = resolve(path);
    if (!isInside(canonicalDirectory, canonicalPath) || !canonicalPath.toLocaleLowerCase("en-US").endsWith(".exe")) {
      throw new Error("更新安装包路径无效。");
    }
    const metadata = await stat(canonicalPath);
    if (!metadata.isFile() || metadata.size !== this.asset.size
      || (await sha256(canonicalPath)).toLocaleLowerCase("en-US") !== this.asset.sha256.toLocaleLowerCase("en-US")) {
      throw new Error("更新安装包完整性已经变化，请重新下载。");
    }
    if (this.asset.certificateSha256 && !await this.publisherVerifier(canonicalPath, this.asset.certificateSha256)) {
      throw new Error("更新安装包发布者证书已经变化，请重新下载。");
    }
    this.setLive({
      state: "downloaded",
      phase: "ready",
      downloadedPath: canonicalPath,
      downloadedBytes: this.asset.size,
      totalBytes: this.asset.size,
      progressPercent: 100,
      canCancel: false,
      canRetry: false,
      message: `版本 ${this.live.latestVersion ?? this.asset.name} 已验证，可以安装。`
    }, true);
    return canonicalPath;
  }

  updateInstallMode(): WindowsUpdateInstallMode {
    return this.installMode;
  }

  async launchDownloadedInstaller(): Promise<UpdateInstallerLaunch> {
    const path = await this.downloadedInstaller();
    await this.installerLauncher(path, this.installMode);
    this.setLive({
      state: "downloaded",
      phase: "ready",
      canCancel: false,
      canRetry: false,
      message: this.installMode === "portable"
        ? "更新安装器已启动；当前便携版将在安装版接管后退出。"
        : "更新安装器已启动；客户端可以安全退出。"
    }, true);
    await this.persistQueue;
    return { path, mode: this.installMode };
  }

  async dispose(timeoutMs = 3_000): Promise<{ timedOut: boolean }> {
    this.abortController?.abort();
    let timedOut = false;
    if (this.job) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.job.catch(() => undefined),
        new Promise<void>((resolveTimeout) => {
          timer = setTimeout(() => { timedOut = true; resolveTimeout(); }, Math.max(1, timeoutMs));
          timer.unref();
        })
      ]);
      if (timer) clearTimeout(timer);
    }
    if (!timedOut) await this.persistQueue;
    return { timedOut };
  }

  private async performCheck(downloadIfAvailable: boolean): Promise<AppUpdateStatus> {
    await mkdir(this.directory, { recursive: true });
    this.setLive({ state: "checking", phase: "checkingRelease", canCancel: false, canRetry: false, message: "正在检查签名的 GitHub Release…" }, true);
    try {
      const releaseChannel = this.options.releaseChannel ?? "stable";
      const useLegacyRunner = Boolean(this.options.runner || this.options.ghExecutable);
      let release: GitHubRelease;
      if (useLegacyRunner) {
        const executable = await this.resolveGh();
        if (!executable) throw new Error("测试更新通道不可用。");
        let requestedTag: string | null = null;
        if (releaseChannel === "beta") {
          const list = await this.runner(executable, this.directory, [
            "release", "list", "--repo", UPDATE_REPOSITORY, "--limit", "100",
            "--json", "tagName,isDraft,isPrerelease,publishedAt"
          ], 120_000);
          if (list.code !== 0) throw new Error(conciseError(list));
          requestedTag = betaReleaseTag(list.stdout);
        }
        const result = await this.runner(executable, this.directory, [
          "release", "view", ...(requestedTag ? [requestedTag] : []), "--repo", UPDATE_REPOSITORY,
          "--json", "tagName,name,url,publishedAt,isDraft,isPrerelease,assets"
        ], 120_000);
        if (result.code !== 0) throw new Error(conciseError(result));
        release = JSON.parse(result.stdout) as GitHubRelease;
      } else if (releaseChannel === "beta") {
        const raw = JSON.parse((await downloadBuffer(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100`)).toString("utf8")) as GitHubApiRelease[];
        if (!Array.isArray(raw)) throw new Error("GitHub 返回的 Beta Release 列表无效。");
        const candidates = raw.map(mapApiRelease).filter((item) => !item.isDraft && item.isPrerelease && /^v?\d+\.\d+\.\d+-beta\.\d+$/.test(item.tagName));
        candidates.sort((left, right) => compareVersions(right.tagName, left.tagName));
        if (!candidates[0]) throw new Error("尚未找到可用的 Beta Release。");
        release = candidates[0];
      } else {
        release = mapApiRelease(JSON.parse((await downloadBuffer(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`)).toString("utf8")) as GitHubApiRelease);
      }
      if (!release || typeof release.tagName !== "string" || typeof release.url !== "string" || !Array.isArray(release.assets)
        || release.isDraft || Boolean(release.isPrerelease) !== (releaseChannel === "beta")) {
        throw new Error("GitHub 返回的 Release 信息无效。");
      }
      const manifestAsset = release.assets.find((asset) => asset.name === RELEASE_MANIFEST_NAME);
      if (!manifestAsset) throw new Error("Release 缺少签名发布清单，已拒绝自动更新。");
      const manifestDirectory = resolve(this.directory, "manifests", release.tagName.replace(/[^A-Za-z0-9_.-]/g, "_"));
      await mkdir(manifestDirectory, { recursive: true });
      const manifestPath = resolve(manifestDirectory, RELEASE_MANIFEST_NAME);
      this.setLive({ phase: "verifyingManifest", message: "正在验证发布清单签名…" }, true);
      if (useLegacyRunner) {
        const executable = await this.resolveGh();
        if (!executable) throw new Error("测试更新通道不可用。");
        const manifestDownload = await this.runner(executable, this.directory, [
          "release", "download", release.tagName, "--repo", UPDATE_REPOSITORY,
          "--pattern", RELEASE_MANIFEST_NAME, "--dir", manifestDirectory, "--clobber"
        ], 120_000);
        if (manifestDownload.code !== 0) throw new Error(conciseError(manifestDownload));
      } else {
        if (!manifestAsset.url) throw new Error("Release 缺少签名清单下载地址。");
        await writeFile(manifestPath, await downloadBuffer(manifestAsset.url, undefined, 1_000_000), { mode: 0o600 });
      }
      const manifestMetadata = await stat(manifestPath);
      if (!manifestMetadata.isFile() || (manifestAsset.size > 0 && manifestMetadata.size !== manifestAsset.size)) {
        throw new Error("签名发布清单大小校验失败。");
      }
      const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")), release, this.publicKeyPem);
      const latestVersion = release.tagName.replace(/^v/i, "");
      const checkedAt = new Date().toISOString();
      const relation = compareVersions(latestVersion, this.options.currentVersion);
      this.release = release;
      this.manifest = manifest;
      this.asset = manifest.signed.assets.find((asset) => asset.kind === "windows-setup") ?? null;
      if (relation <= 0) {
        this.setLive({
          state: "upToDate",
          phase: "ready",
          latestVersion,
          releaseName: release.name,
          releaseUrl: release.url,
          publishedAt: release.publishedAt,
          checkedAt,
          message: `当前已是最新版本 ${this.options.currentVersion}。`
        }, true);
        return this.status();
      }
      if (!this.asset) throw new Error("签名发布清单中没有 Windows 安装包。");
      this.setLive({
        state: "available",
        phase: "idle",
        latestVersion,
        releaseName: release.name,
        releaseUrl: release.url,
        publishedAt: release.publishedAt,
        checkedAt,
        totalBytes: this.asset.size,
        downloadedBytes: 0,
        progressPercent: 0,
        message: `发现已验证的新版本 ${latestVersion}。`
      }, true);
      return downloadIfAvailable ? this.performDownload() : this.status();
    } catch (error) {
      this.release = null;
      this.manifest = null;
      this.asset = null;
      this.setLive({
        ...this.live,
        state: "error",
        phase: "failed",
        canRetry: true,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "检查更新失败。"
      }, true);
      return this.status();
    }
  }

  private async performDownload(): Promise<AppUpdateStatus> {
    if (!this.release || !this.manifest || !this.asset) {
      const checked = await this.performCheck(false);
      if (checked.state !== "available" || !this.release || !this.manifest || !this.asset) return checked;
    }
    const release = this.release;
    const asset = this.asset;
    const version = release.tagName.replace(/^v/i, "");
    const destinationDirectory = resolve(this.directory, version);
    if (!isInside(resolve(this.directory), destinationDirectory)) throw new Error("更新目录无效。");
    await mkdir(destinationDirectory, { recursive: true });
    const destination = resolve(destinationDirectory, asset.name);
    try {
      const existing = await stat(destination);
      if (existing.isFile() && existing.size === asset.size
        && (await sha256(destination)).toLocaleLowerCase("en-US") === asset.sha256.toLocaleLowerCase("en-US")
        && (!asset.certificateSha256 || await this.publisherVerifier(destination, asset.certificateSha256))) {
        this.setLive({ state: "downloaded", phase: "ready", downloadedPath: destination,
          downloadedBytes: asset.size, totalBytes: asset.size, progressPercent: 100,
          canCancel: false, canRetry: false, message: `版本 ${version} 已验证，可以安装。` }, true);
        return this.status();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporary = `${destination}.part`;
    this.partialPath = temporary;
    let resumeFrom = 0;
    try {
      const partial = await stat(temporary);
      if (partial.isFile() && partial.size <= asset.size) resumeFrom = partial.size;
      else await rm(temporary, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const controller = new AbortController();
    this.abortController = controller;
    this.setLive({ state: "downloading", phase: resumeFrom ? "downloading" : "preparingDownload",
      downloadedBytes: resumeFrom, totalBytes: asset.size,
      progressPercent: Math.min(100, Math.floor((resumeFrom / asset.size) * 100)),
      canCancel: true, canRetry: false,
      message: resumeFrom ? `正在从 ${(resumeFrom / 1024 / 1024).toFixed(1)} MB 处继续下载 ${version}…` : `正在准备下载 ${version}…` }, true);
    try {
      const releaseAsset = release.assets.find((item) => item.name === asset.name);
      const downloadUrl = releaseAsset?.url
        ?? `https://github.com/${UPDATE_REPOSITORY}/releases/download/${encodeURIComponent(release.tagName)}/${encodeURIComponent(asset.name)}`;
      if (this.options.runner && !this.options.downloader) {
        const executable = await this.resolveGh();
        if (!executable) throw new Error("测试更新通道不可用。");
        const result = await this.runner(executable, this.directory, [
          "release", "download", release.tagName, "--repo", UPDATE_REPOSITORY,
          "--pattern", asset.name, "--dir", destinationDirectory, "--clobber"
        ], 15 * 60_000);
        if (result.code !== 0) throw new Error(conciseError(result));
        if (!existsSync(temporary) && existsSync(destination)) await rename(destination, temporary);
      } else {
        await this.downloader(downloadUrl, temporary, {
          expectedSize: asset.size,
          resumeFrom,
          signal: controller.signal,
          onProgress: ({ downloadedBytes, totalBytes }) => {
            const now = Date.now();
            if (downloadedBytes < totalBytes && now - this.lastProgressAt < 150) return;
            this.lastProgressAt = now;
            const progressPercent = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
            const persist = downloadedBytes === totalBytes || now - this.lastProgressPersistAt >= 1_000;
            if (persist) this.lastProgressPersistAt = now;
            this.setLive({ state: "downloading", phase: "downloading", downloadedBytes, totalBytes,
              progressPercent, canCancel: true, canRetry: false,
              message: `正在下载 ${version} · ${progressPercent}%` }, persist);
          }
        });
      }
      this.setLive({ state: "downloading", phase: "verifyingPackage", canCancel: false,
        downloadedBytes: asset.size, totalBytes: asset.size, progressPercent: 100,
        message: `下载完成，正在验证 ${version}…` }, true);
      const metadata = await stat(temporary);
      if (!metadata.isFile() || metadata.size !== asset.size) throw new Error("更新安装包大小校验失败。");
      if ((await sha256(temporary)).toLocaleLowerCase("en-US") !== asset.sha256.toLocaleLowerCase("en-US")) {
        throw new Error("更新安装包 SHA-256 校验失败。");
      }
      if (asset.certificateSha256 && !await this.publisherVerifier(temporary, asset.certificateSha256)) {
        throw new Error("更新安装包发布者证书校验失败。");
      }
      const backup = `${destination}.previous-${randomBytes(4).toString("hex")}`;
      let backedUp = false;
      try {
        if (existsSync(destination)) {
          await rename(destination, backup);
          backedUp = true;
        }
        await rename(temporary, destination);
        this.partialPath = null;
        if (backedUp) await rm(backup, { force: true });
      } catch (error) {
        if (backedUp && !existsSync(destination) && existsSync(backup)) await rename(backup, destination);
        throw error;
      }
      this.setLive({ state: "downloaded", phase: "ready", downloadedPath: destination,
        downloadedBytes: asset.size, totalBytes: asset.size, progressPercent: 100,
        canCancel: false, canRetry: false, message: `版本 ${version} 已验证，可以安装。` }, true);
      return this.status();
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      if (!cancelled && error instanceof Error && /大小校验|SHA-256|发布者证书|超过签名清单/.test(error.message)) {
        await rm(temporary, { force: true });
        this.partialPath = null;
      }
      this.setLive({ state: cancelled ? "cancelled" : "error", phase: cancelled ? "cancelled" : "failed",
        canCancel: false, canRetry: true,
        message: cancelled ? "更新下载已取消；已下载部分已保留。" : error instanceof Error ? error.message : "下载更新失败。" }, true);
      return this.status();
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  private setLive(patch: Partial<AppUpdateStatus>, persist = false): void {
    this.live = { ...this.live, ...patch };
    if (persist) this.queueStateWrite();
    const listener = this.options.onStatus;
    if (listener) void this.status().then(listener).catch(() => undefined);
  }

  private statePath(): string {
    return join(this.directory, "status.json");
  }

  private async restoreState(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    try {
      const value = JSON.parse(await readFile(this.statePath(), "utf8")) as StoredUpdateState;
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.state !== "string") return;
      const { partialPath, ...restored } = value;
      this.partialPath = typeof partialPath === "string" && isInside(resolve(this.directory), resolve(partialPath))
        ? resolve(partialPath) : null;
      if (this.partialPath && typeof restored.totalBytes === "number" && restored.totalBytes > 0) {
        try {
          const partial = await stat(this.partialPath);
          if (partial.isFile() && partial.size <= restored.totalBytes) {
            restored.downloadedBytes = partial.size;
            restored.progressPercent = Math.min(100, Math.floor((partial.size / restored.totalBytes) * 100));
          }
        } catch {
          restored.downloadedBytes = 0;
          restored.progressPercent = 0;
        }
      }
      if (restored.state === "checking" || restored.state === "downloading") {
        restored.state = "cancelled";
        restored.phase = "cancelled";
        restored.canCancel = false;
        restored.canRetry = true;
        restored.message = "上次下载被客户端关闭中断；可从已保存的进度继续。";
      }
      this.live = { ...this.live, ...restored };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }

  private queueStateWrite(): void {
    const snapshot: StoredUpdateState = { ...this.live, partialPath: this.partialPath ?? undefined };
    this.persistQueue = this.persistQueue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const path = this.statePath();
      const temporary = `${path}.${randomBytes(5).toString("hex")}.tmp`;
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    }).catch(() => undefined);
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
