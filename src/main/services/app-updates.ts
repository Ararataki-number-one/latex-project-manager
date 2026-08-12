import { createHash, randomBytes, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

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

export interface AppUpdateServiceOptions {
  currentVersion: string;
  releaseChannel?: "stable" | "beta";
  env?: NodeJS.ProcessEnv;
  ghExecutable?: string;
  runner?: UpdateCommandRunner;
  publicKeyPem?: string | Buffer;
  publisherVerifier?: (path: string, expectedCertificateSha256: string) => Promise<boolean>;
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
  beta: number | null;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(value.trim());
  return match ? {
    core: match.slice(1, 4).map((part) => Number.parseInt(part, 10)),
    beta: match[4] === undefined ? null : Number.parseInt(match[4], 10)
  } : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Release 版本号格式无效。");
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.beta === null && b.beta !== null) return 1;
  if (a.beta !== null && b.beta === null) return -1;
  if (a.beta !== b.beta) return (a.beta ?? 0) > (b.beta ?? 0) ? 1 : -1;
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
  private ghExecutable: string | null | undefined;
  private release: GitHubRelease | null = null;
  private manifest: SignedReleaseManifest | null = null;
  private asset: SignedReleaseAsset | null = null;
  private job: Promise<AppUpdateStatus> | null = null;
  private live: Partial<AppUpdateStatus> = { state: "idle" };

  constructor(private readonly directory: string, private readonly options: AppUpdateServiceOptions) {
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? defaultRunner;
    this.publicKeyPem = options.publicKeyPem ?? RELEASE_MANIFEST_PUBLIC_KEY_PEM;
    this.publisherVerifier = options.publisherVerifier ?? defaultPublisherVerifier;
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
    if (!path || this.live.state !== "downloaded" || !this.asset) throw new Error("请先下载可用更新。");
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
    return canonicalPath;
  }

  private async performCheck(downloadIfAvailable: boolean): Promise<AppUpdateStatus> {
    await mkdir(this.directory, { recursive: true });
    this.live = { ...this.live, state: "checking", message: "正在检查签名的 GitHub Release…" };
    const executable = await this.resolveGh();
    if (!executable) return this.status();
    try {
      const releaseChannel = this.options.releaseChannel ?? "stable";
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
      const release = JSON.parse(result.stdout) as GitHubRelease;
      if (!release || typeof release.tagName !== "string" || typeof release.url !== "string" || !Array.isArray(release.assets)
        || release.isDraft || Boolean(release.isPrerelease) !== (releaseChannel === "beta")) {
        throw new Error("GitHub 返回的 Release 信息无效。");
      }
      const manifestAsset = release.assets.find((asset) => asset.name === RELEASE_MANIFEST_NAME);
      if (!manifestAsset) throw new Error("Release 缺少签名发布清单，已拒绝自动更新。");
      const manifestDirectory = resolve(this.directory, "manifests", release.tagName.replace(/[^A-Za-z0-9_.-]/g, "_"));
      await mkdir(manifestDirectory, { recursive: true });
      const manifestPath = resolve(manifestDirectory, RELEASE_MANIFEST_NAME);
      const manifestDownload = await this.runner(executable, this.directory, [
        "release", "download", release.tagName, "--repo", UPDATE_REPOSITORY,
        "--pattern", RELEASE_MANIFEST_NAME, "--dir", manifestDirectory, "--clobber"
      ], 120_000);
      if (manifestDownload.code !== 0) throw new Error(conciseError(manifestDownload));
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
      if (!this.asset) throw new Error("签名发布清单中没有 Windows 安装包。");
      this.live = {
        state: "available",
        latestVersion,
        releaseName: release.name,
        releaseUrl: release.url,
        publishedAt: release.publishedAt,
        checkedAt,
        message: `发现已验证的新版本 ${latestVersion}。`
      };
      return downloadIfAvailable ? this.performDownload() : this.status();
    } catch (error) {
      this.release = null;
      this.manifest = null;
      this.asset = null;
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
    if (!this.release || !this.manifest || !this.asset) {
      const checked = await this.performCheck(false);
      if (checked.state !== "available" || !this.release || !this.manifest || !this.asset) return checked;
    }
    const executable = await this.resolveGh();
    if (!executable) return this.status();
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
        this.live = { ...this.live, state: "downloaded", downloadedPath: destination, message: `版本 ${version} 已验证，可以安装。` };
        return this.status();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    this.live = { ...this.live, state: "downloading", message: `正在下载并验证 ${version}…` };
    const temporaryDirectory = resolve(destinationDirectory, `.download-${randomBytes(6).toString("hex")}`);
    await mkdir(temporaryDirectory, { recursive: true });
    const temporary = resolve(temporaryDirectory, asset.name);
    try {
      const result = await this.runner(executable, this.directory, [
        "release", "download", release.tagName, "--repo", UPDATE_REPOSITORY,
        "--pattern", asset.name, "--dir", temporaryDirectory
      ], 15 * 60_000);
      if (result.code !== 0) throw new Error(conciseError(result));
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
        if (backedUp) await rm(backup, { force: true });
      } catch (error) {
        if (backedUp && !existsSync(destination) && existsSync(backup)) await rename(backup, destination);
        throw error;
      }
      this.live = { ...this.live, state: "downloaded", downloadedPath: destination, message: `版本 ${version} 已验证，可以安装。` };
      return this.status();
    } catch (error) {
      this.live = { ...this.live, state: "error", message: error instanceof Error ? error.message : "下载更新失败。" };
      return this.status();
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
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
