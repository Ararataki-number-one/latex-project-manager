import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { watch, type FSWatcher } from "chokidar";

import type {
  DesktopEnvironmentStatus,
  GitHubChangedFile,
  GitHubAccountStatus,
  GitHubCreateRepositoryOptions,
  GitIdentity,
  GitHubLargeFile,
  GitHubRepositoryVisibility,
  GitHubSyncEvent,
  GitHubSyncSettings,
  GitHubSyncState,
  GitHubSyncStatus,
  SyncSecurityFinding
} from "../../shared/types";
import { scanSyncSecuritySnapshot } from "./sync-security";

const LARGE_FILE_WARNING = 50 * 1024 * 1024;
const CONFIG_VERSION = 1;
const MANAGED_IGNORE_BEGIN = "# >>> LaTeX Project Manager managed ignores";
const MANAGED_IGNORE_END = "# <<< LaTeX Project Manager managed ignores";
const MANAGED_IGNORES = [
  ".latex-workbench/build/",
  ".latex-workbench/runtime/",
  ".latex-workbench/snapshots/",
  ".latex-workbench/trash/",
  "*.aux",
  "*.bcf",
  "*.blg",
  "*.fdb_latexmk",
  "*.fls",
  "*.ilg",
  "*.ind",
  "*.lof",
  "*.log",
  "*.lot",
  "*.out",
  "*.run.xml",
  "*.synctex.gz",
  "*.toc",
  "_minted-*/"
] as const;

interface StoredSyncConfig extends GitHubSyncSettings {
  schemaVersion: typeof CONFIG_VERSION;
  projectId: string;
  lastSyncAt?: string;
  lastError?: string;
  repositoryFullName?: string;
  visibility?: GitHubRepositoryVisibility;
  acknowledgedWarnings?: string[];
  acknowledgedTreeHash?: string;
}

export interface GitCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (
  executable: string,
  cwd: string,
  args: string[],
  options: { background: boolean; signal?: AbortSignal }
) => Promise<GitCommandResult>;

interface WatcherLike {
  close(): Promise<void> | void;
}

export interface GitHubSyncServiceOptions {
  gitExecutable?: string;
  githubCliExecutable?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  runner?: GitCommandRunner;
  debounceMs?: number;
  watcherFactory?: (root: string, onChange: () => void) => WatcherLike;
  loginLauncher?: (executable: string, cwd: string, args: string[]) => Promise<void>;
  maxConcurrent?: number;
  retryDelaysMs?: number[];
  onEvent?: (event: GitHubSyncEvent) => void;
  onStatus?: (projectId: string, state: GitHubSyncState, message?: string) => void;
}

interface LiveStatus {
  state: GitHubSyncState;
  message?: string;
  nextRetryAt?: string;
  securityFindings?: SyncSecurityFinding[];
}

interface QueuedSync {
  projectId: string;
  root: string;
  background: boolean;
  resolve: (status: GitHubSyncStatus) => void;
  settled: boolean;
}

interface CandidateSecuritySnapshot {
  treeHash: string;
  changes: GitHubChangedFile[];
  largeFiles: GitHubLargeFile[];
  findings: SyncSecurityFinding[];
}

class SyncNeedsPullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncNeedsPullError";
  }
}

class SyncSecurityBlockedError extends Error {
  constructor(message: string, readonly findings: SyncSecurityFinding[]) {
    super(message);
    this.name = "SyncSecurityBlockedError";
  }
}

class SyncWarningApprovalError extends Error {
  constructor(message: string, readonly findings: SyncSecurityFinding[]) {
    super(message);
    this.name = "SyncWarningApprovalError";
  }
}

function retryableNetworkError(message: string): boolean {
  return /(?:could not resolve|failed to connect|connection (?:timed out|reset)|network is unreachable|unable to access|tls|ssl|http 5\d\d|remote end hung up)/i.test(message);
}

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function foldedPath(value: string, platform: NodeJS.Platform): string {
  const normalized = resolve(value);
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function conciseError(result: GitCommandResult): string {
  const value = (result.stderr || result.stdout || `Git exited with code ${result.code}`).trim();
  return value.length > 800 ? `${value.slice(0, 800)}…` : value;
}

function repositoryCoordinates(remoteUrl: string): { owner: string; name: string; fullName: string } {
  const normalized = normalizeGitHubRemoteUrl(remoteUrl);
  const match = /github\.com(?::|\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(normalized);
  if (!match) throw new Error("无法从仓库地址识别 owner/repository。");
  return { owner: match[1], name: match[2], fullName: `${match[1]}/${match[2]}` };
}

function validatedRepositoryName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 100 || name === "." || name === ".." || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error("仓库名只能包含字母、数字、点、短横线和下划线，且不能超过 100 个字符。");
  }
  return name;
}

function emptyGitIdentity(): GitIdentity {
  return { name: "", email: "", configured: false, source: "none" };
}

function defaultRunner(
  executable: string,
  cwd: string,
  args: string[],
  options: { background: boolean; signal?: AbortSignal }
): Promise<GitCommandResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: options.background ? "never" : "auto",
        LC_ALL: "C",
        LANG: "C"
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const terminateTree = (): void => {
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
    };
    const abort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminateTree();
      const error = new Error("Git synchronization was cancelled.");
      error.name = "AbortError";
      rejectRun(error);
    };
    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= 3_000_000) return current;
      return `${current}${chunk.toString("utf8")}`.slice(0, 3_000_000);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateTree();
      rejectRun(new Error("Git operation timed out."));
    }, 120_000);
    timer.unref();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      rejectRun(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolveRun({ code: code ?? -1, stdout, stderr });
    });
  });
}

function defaultLoginLauncher(executable: string, cwd: string, args: string[]): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      detached: true,
      windowsHide: false,
      stdio: "ignore"
    });
    child.once("error", rejectLaunch);
    child.once("spawn", () => {
      child.unref();
      resolveLaunch();
    });
  });
}

function defaultWatcherFactory(root: string, onChange: () => void): FSWatcher {
  const foldedRoot = resolve(root);
  return watch(foldedRoot, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 120 },
    ignored: (path) => {
      const relation = portablePath(relative(foldedRoot, resolve(path))).toLocaleLowerCase("en-US");
      return relation === ".git" || relation.startsWith(".git/")
        || relation === ".latex-workbench/build" || relation.startsWith(".latex-workbench/build/")
        || relation === ".latex-workbench/runtime" || relation.startsWith(".latex-workbench/runtime/")
        || relation === ".latex-workbench/snapshots" || relation.startsWith(".latex-workbench/snapshots/")
        || relation === ".latex-workbench/trash" || relation.startsWith(".latex-workbench/trash/");
    }
  }).on("all", (event) => {
    if (event !== "ready") onChange();
  });
}

export function normalizeGitHubRemoteUrl(value: string): string {
  const input = value.trim();
  if (!input || input.length > 500 || /[\r\n\0]/.test(input)) throw new Error("请输入有效的 GitHub 仓库地址。");
  const scp = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(input);
  if (scp) return `git@github.com:${scp[1]}/${scp[2]}.git`;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("仓库地址必须是 GitHub HTTPS 或 SSH 地址。");
  }
  if (!new Set(["https:", "ssh:"]).has(parsed.protocol) || parsed.hostname.toLocaleLowerCase("en-US") !== "github.com") {
    throw new Error("首版仅支持 github.com 的 HTTPS 或 SSH 仓库地址。");
  }
  if (parsed.password || (parsed.protocol === "https:" && parsed.username)) {
    throw new Error("仓库地址中不能包含用户名、密码或访问令牌。");
  }
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(parsed.pathname);
  if (!match) throw new Error("GitHub 仓库地址应为 owner/repository 格式。");
  if (parsed.protocol === "ssh:" && parsed.username && parsed.username !== "git") {
    throw new Error("GitHub SSH 地址必须使用 git 用户。");
  }
  return parsed.protocol === "ssh:"
    ? `ssh://git@github.com/${match[1]}/${match[2]}.git`
    : `https://github.com/${match[1]}/${match[2]}.git`;
}

export type SafeRemoteAction = "none" | "fastForward" | "blocked";

export function decideSafeRemoteAction(ahead: number, behind: number, localChanges: number): SafeRemoteAction {
  if (behind <= 0) return "none";
  return ahead === 0 && localChanges === 0 ? "fastForward" : "blocked";
}

function parseChangedFiles(output: string): GitHubChangedFile[] {
  const result: GitHubChangedFile[] = [];
  for (const record of output.split("\0")) {
    if (record.length < 4 || record[2] !== " ") continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (path) result.push({ path: portablePath(path), status });
  }
  return result;
}

function managedIgnoreBlock(lineEnding: "\n" | "\r\n"): string {
  return [MANAGED_IGNORE_BEGIN, ...MANAGED_IGNORES, MANAGED_IGNORE_END].join(lineEnding);
}

async function ensureManagedGitIgnore(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lineEnding = current.includes("\r\n") ? "\r\n" : "\n";
  const block = managedIgnoreBlock(lineEnding);
  const start = current.indexOf(MANAGED_IGNORE_BEGIN);
  const end = current.indexOf(MANAGED_IGNORE_END);
  let next: string;
  if (start >= 0 && end >= start) {
    next = `${current.slice(0, start)}${block}${current.slice(end + MANAGED_IGNORE_END.length)}`;
  } else {
    const prefix = current && !current.endsWith("\n") ? `${current}${lineEnding}${lineEnding}` : current ? `${current}${lineEnding}` : "";
    next = `${prefix}${block}${lineEnding}`;
  }
  if (next !== current) await writeFile(path, next, { encoding: "utf8", mode: 0o600 });
}

export class GitHubSyncService {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: GitCommandRunner;
  private readonly debounceMs: number;
  private readonly maxConcurrent: number;
  private readonly retryDelaysMs: number[];
  private readonly watcherFactory: (root: string, onChange: () => void) => WatcherLike;
  private readonly loginLauncher: (executable: string, cwd: string, args: string[]) => Promise<void>;
  private readonly onEvent?: (event: GitHubSyncEvent) => void;
  private readonly onStatus?: (projectId: string, state: GitHubSyncState, message?: string) => void;
  private readonly roots = new Map<string, string>();
  private readonly watchers = new Map<string, WatcherLike>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pollTimers = new Map<string, NodeJS.Timeout>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly jobs = new Map<string, Promise<GitHubSyncStatus>>();
  private readonly queue: QueuedSync[] = [];
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeSignalsByRoot = new Map<string, AbortSignal>();
  private readonly rerunAfter = new Set<string>();
  private readonly live = new Map<string, LiveStatus>();
  private activeJobs = 0;
  private paused = false;
  private executable: string | null | undefined;
  private githubCliExecutable: string | null | undefined;
  private gitVersion: string | undefined;
  private githubCliVersion: string | undefined;
  private lfsAvailable: boolean | undefined;

  constructor(private readonly configDirectory: string, options: GitHubSyncServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? defaultRunner;
    this.debounceMs = Math.max(1_000, options.debounceMs ?? 10_000);
    this.maxConcurrent = Math.max(1, Math.min(8, options.maxConcurrent ?? 2));
    this.retryDelaysMs = (options.retryDelaysMs?.length ? options.retryDelaysMs : [30_000, 120_000, 300_000])
      .map((value) => Math.max(1_000, value));
    this.watcherFactory = options.watcherFactory ?? defaultWatcherFactory;
    this.loginLauncher = options.loginLauncher ?? defaultLoginLauncher;
    this.onEvent = options.onEvent;
    this.onStatus = options.onStatus;
    if (options.gitExecutable) this.executable = options.gitExecutable;
    if (options.githubCliExecutable) this.githubCliExecutable = options.githubCliExecutable;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async pauseAll(): Promise<void> {
    this.paused = true;
    for (const controller of this.activeControllers.values()) controller.abort();
    for (const [projectId] of this.roots) this.setLive(projectId, "queued", "自动同步已暂停，变更仍保留在本机。", "info");
  }

  async resumeAll(): Promise<void> {
    this.paused = false;
    for (const [projectId, root] of this.roots) {
      const config = await this.readConfig(projectId);
      if (config?.autoSync) this.scheduleSync(projectId, 1_000);
      else if (this.live.get(projectId)?.state === "queued") this.setLive(projectId, "ready", "自动同步未开启。", "info");
      this.roots.set(projectId, root);
    }
    this.pumpQueue();
  }

  async syncAll(background = false): Promise<GitHubSyncStatus[]> {
    const tasks: Array<Promise<GitHubSyncStatus>> = [];
    for (const [projectId, root] of this.roots) {
      const config = await this.readConfig(projectId);
      if (config) tasks.push(this.syncNow(projectId, root, background));
    }
    return Promise.all(tasks);
  }

  async securityPreflight(projectId: string, root: string, includeTracked = false): Promise<SyncSecurityFinding[]> {
    this.roots.set(projectId, resolve(root));
    await this.requireGit(root);
    await this.ensureRepository(root);
    await this.run(root, ["add", "-A", "--", "."]);
    return (await this.candidateSecuritySnapshot(root, includeTracked)).findings;
  }

  async acknowledgeWarnings(projectId: string, root: string, paths: string[]): Promise<GitHubSyncStatus> {
    const config = await this.readConfig(projectId);
    if (!config) throw new Error("请先连接 GitHub 仓库。");
    const safePaths = [...new Set(paths.map((path) => portablePath(path.trim())).filter(Boolean))];
    await this.requireGit(root);
    await this.ensureRepository(root);
    await this.run(root, ["add", "-A", "--", "."]);
    const snapshot = await this.candidateSecuritySnapshot(root, false);
    const findings = snapshot.findings;
    const allowed = new Set(findings.filter((finding) => finding.severity === "warning").map((finding) => finding.path));
    if (!safePaths.length || safePaths.some((path) => !allowed.has(path))) throw new Error("需要确认的同步警告已经变化，请重新检查。");
    await this.writeConfig({
      ...config,
      acknowledgedWarnings: [...new Set(safePaths)],
      acknowledgedTreeHash: snapshot.treeHash
    });
    this.setLive(projectId, "queued", "已确认普通同步警告，正在重新同步。", "info");
    return this.syncNow(projectId, root, false);
  }

  private setLive(
    projectId: string,
    state: GitHubSyncState,
    message: string,
    level: GitHubSyncEvent["level"],
    extra: Pick<LiveStatus, "nextRetryAt" | "securityFindings"> = {}
  ): void {
    const previous = this.live.get(projectId);
    const next: LiveStatus = { state, message, ...extra };
    this.live.set(projectId, next);
    this.onStatus?.(projectId, state, message);
    if (previous?.state === state && previous.message === message && previous.nextRetryAt === next.nextRetryAt) return;
    this.onEvent?.({
      id: randomBytes(12).toString("hex"),
      projectId,
      occurredAt: new Date().toISOString(),
      state,
      level,
      message
    });
  }

  async authStatus(cwd = process.cwd()): Promise<GitHubAccountStatus> {
    const executable = await this.resolveGitHubCli(cwd);
    if (!executable) {
      return {
        cliAvailable: false,
        authenticated: false,
        message: "未检测到 GitHub CLI。安装后可在客户端中使用浏览器登录。"
      };
    }
    const authentication = await this.runGitHubCli(cwd, ["auth", "status", "--hostname", "github.com"], [0, 1], true);
    if (authentication.code !== 0) {
      return {
        cliAvailable: true,
        cliVersion: this.githubCliVersion,
        authenticated: false,
        message: "GitHub CLI 已安装，但尚未登录。"
      };
    }
    const profile = await this.runGitHubCli(cwd, ["api", "user"], [0], true);
    let value: { login?: string; name?: string | null; email?: string | null; id?: number } = {};
    try {
      value = JSON.parse(profile.stdout) as typeof value;
    } catch {
      throw new Error("GitHub 已登录，但无法读取账号信息。");
    }
    const login = value.login?.trim();
    if (!login) throw new Error("GitHub 已登录，但账号名称为空。");
    const email = value.email?.trim() || (Number.isFinite(value.id) ? `${value.id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com`);
    return {
      cliAvailable: true,
      cliVersion: this.githubCliVersion,
      authenticated: true,
      login,
      name: value.name?.trim() || login,
      email,
      message: `已登录 GitHub：${login}`
    };
  }

  async environmentStatus(cwd = process.cwd()): Promise<DesktopEnvironmentStatus> {
    const [git, githubCli] = await Promise.all([this.resolveGit(cwd), this.resolveGitHubCli(cwd)]);
    return {
      gitAvailable: Boolean(git),
      gitVersion: this.gitVersion,
      gitLfsAvailable: git ? await this.probeLfs(cwd) : false,
      githubCliAvailable: Boolean(githubCli),
      githubCliVersion: this.githubCliVersion
    };
  }

  async beginLogin(cwd = process.cwd()): Promise<GitHubAccountStatus> {
    const current = await this.authStatus(cwd);
    if (current.authenticated) return current;
    const executable = await this.resolveGitHubCli(cwd);
    if (!executable) throw new Error("请先安装 GitHub CLI，再返回客户端登录。");
    await this.loginLauncher(executable, cwd, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"]);
    return {
      cliAvailable: true,
      cliVersion: this.githubCliVersion,
      authenticated: false,
      message: "已打开 GitHub 官方登录窗口；完成网页登录后回到客户端点击“刷新登录状态”。"
    };
  }

  async attachProject(projectId: string, root: string): Promise<void> {
    this.roots.set(projectId, resolve(root));
    const config = await this.readConfig(projectId);
    if (config?.autoSync) {
      await this.startWatcher(projectId);
      this.scheduleSync(projectId, 2_000);
    }
  }

  async detachProject(projectId: string): Promise<void> {
    const timer = this.timers.get(projectId);
    if (timer) clearTimeout(timer);
    this.timers.delete(projectId);
    const pollTimer = this.pollTimers.get(projectId);
    if (pollTimer) clearInterval(pollTimer);
    this.pollTimers.delete(projectId);
    const retryTimer = this.retryTimers.get(projectId);
    if (retryTimer) clearTimeout(retryTimer);
    this.retryTimers.delete(projectId);
    this.retryAttempts.delete(projectId);
    this.rerunAfter.delete(projectId);
    this.activeControllers.get(projectId)?.abort();
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].projectId !== projectId) continue;
      const queued = this.queue.splice(index, 1)[0];
      this.settleQueued(queued, await this.cancelledStatus(projectId, queued.root));
    }
    const watcher = this.watchers.get(projectId);
    this.watchers.delete(projectId);
    if (watcher) await watcher.close();
    this.roots.delete(projectId);
    this.live.delete(projectId);
  }

  async dispose(): Promise<void> {
    // Stop every source of new work before the first await.  In particular,
    // active Git/Git-LFS process trees must receive their abort signal even if
    // closing a filesystem watcher takes time.
    const watcherClosures = [...this.watchers.values()].map((watcher) => watcher.close());
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.pollTimers.values()) clearInterval(timer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.watchers.clear();
    this.timers.clear();
    this.pollTimers.clear();
    this.retryTimers.clear();
    const activeJobs = [...this.activeControllers.entries()].map(([projectId, controller]) => {
      controller.abort();
      return this.jobs.get(projectId);
    }).filter((job): job is Promise<GitHubSyncStatus> => Boolean(job));
    for (const queued of this.queue.splice(0)) {
      this.settleQueued(queued, await this.cancelledStatus(queued.projectId, queued.root));
    }
    await Promise.allSettled([...watcherClosures, ...activeJobs]);
    this.activeControllers.clear();
    this.activeSignalsByRoot.clear();
  }

  async notifyProjectChanged(projectId: string, root: string): Promise<void> {
    if (!this.roots.has(projectId)) await this.attachProject(projectId, root);
    const config = await this.readConfig(projectId);
    if (config?.autoSync) this.scheduleSync(projectId);
  }

  async configure(projectId: string, root: string, settings: GitHubSyncSettings): Promise<GitHubSyncStatus> {
    const remoteUrl = normalizeGitHubRemoteUrl(settings.remoteUrl);
    if (typeof settings.autoSync !== "boolean" || typeof settings.useLfsForDocuments !== "boolean") {
      throw new Error("GitHub 同步设置无效。");
    }
    this.roots.set(projectId, resolve(root));
    await this.requireGit(root);
    await this.ensureRepository(root);
    const branch = await this.ensureBranch(root);
    const currentRemote = await this.run(root, ["remote", "get-url", "origin"], [0, 2, 128]);
    if (currentRemote.code === 0) await this.run(root, ["remote", "set-url", "origin", remoteUrl]);
    else await this.run(root, ["remote", "add", "origin", remoteUrl]);
    await ensureManagedGitIgnore(root);
    const hasLfs = await this.probeLfs(root);
    if (settings.useLfsForDocuments) {
      if (!hasLfs) throw new Error("未检测到 Git LFS；请安装 Git for Windows/Git LFS，或关闭“大型文稿使用 Git LFS”。");
      await mkdir(this.managedHooksDirectory(root), { recursive: true });
      await this.run(root, ["lfs", "install", "--local", "--force"]);
      await this.run(root, ["lfs", "track", "*.pdf", "*.epub", "*.djvu"]);
    }
    const previous = await this.readConfig(projectId);
    const coordinates = repositoryCoordinates(remoteUrl);
    await this.writeConfig({
      schemaVersion: CONFIG_VERSION,
      projectId,
      remoteUrl,
      autoSync: settings.autoSync,
      useLfsForDocuments: settings.useLfsForDocuments,
      lastSyncAt: previous?.lastSyncAt,
      repositoryFullName: coordinates.fullName,
      visibility: previous?.repositoryFullName === coordinates.fullName ? previous.visibility : undefined,
      acknowledgedWarnings: previous?.repositoryFullName === coordinates.fullName ? previous.acknowledgedWarnings : undefined
    });
    this.setLive(projectId, "ready", `已连接 ${remoteUrl}，当前分支 ${branch}。`, "info");
    if (settings.autoSync) await this.startWatcher(projectId);
    else await this.stopWatcher(projectId);
    return this.status(projectId, root);
  }

  async setAutoSync(projectId: string, root: string, enabled: boolean): Promise<GitHubSyncStatus> {
    if (typeof enabled !== "boolean") throw new Error("自动同步开关无效。");
    const config = await this.readConfig(projectId);
    if (!config) throw new Error("请先连接 GitHub 仓库。");
    await this.writeConfig({ ...config, autoSync: enabled });
    this.roots.set(projectId, resolve(root));
    if (enabled) {
      await this.startWatcher(projectId);
      this.scheduleSync(projectId, 1_500);
    } else {
      await this.stopWatcher(projectId);
    }
    this.setLive(projectId, "ready", enabled ? "已开启自动同步。" : "已暂停自动同步。", "info");
    return this.status(projectId, root);
  }

  async setIdentity(
    projectId: string,
    root: string,
    identity: Pick<GitIdentity, "name" | "email">
  ): Promise<GitHubSyncStatus> {
    const name = identity?.name?.trim();
    const email = identity?.email?.trim();
    if (!name || name.length > 100 || /[\r\n\0]/.test(name)) {
      throw new Error("请输入 1–100 个字符的 Git 提交姓名。");
    }
    if (!email || email.length > 254 || /[\r\n\0\s]/.test(email) || !/^[^@]+@[^@]+$/.test(email)) {
      throw new Error("请输入有效的 Git 提交邮箱；也可以使用 GitHub 的 noreply 邮箱。");
    }
    this.roots.set(projectId, resolve(root));
    await this.requireGit(root);
    await this.ensureRepository(root);
    await this.run(root, ["config", "--local", "user.name", name]);
    await this.run(root, ["config", "--local", "user.email", email]);
    this.setLive(projectId, "ready", "已为当前项目保存 Git 提交身份。", "info");
    return this.status(projectId, root);
  }

  async createRepository(
    projectId: string,
    root: string,
    options: GitHubCreateRepositoryOptions
  ): Promise<GitHubSyncStatus> {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("GitHub 建仓设置无效。");
    const repositoryName = validatedRepositoryName(options.repositoryName);
    if (!new Set<GitHubRepositoryVisibility>(["public", "private"]).has(options.visibility)) {
      throw new Error("仓库可见性设置无效。");
    }
    if (typeof options.autoSync !== "boolean" || typeof options.useLfsForDocuments !== "boolean") {
      throw new Error("GitHub 同步设置无效。");
    }
    this.roots.set(projectId, resolve(root));
    const account = await this.authStatus(root);
    if (!account.authenticated || !account.login) throw new Error("请先在客户端设置中登录 GitHub。");
    await this.requireGit(root);
    await this.ensureRepository(root);
    await this.run(root, ["add", "-A", "--", "."]);
    const preflightSnapshot = await this.candidateSecuritySnapshot(root, true);
    const preflight = preflightSnapshot.findings;
    const blocked = preflight.filter((finding) => finding.severity === "block");
    if (blocked.length) {
      this.setLive(projectId, "blocked", blocked[0].message, "error", { securityFindings: preflight });
      throw new SyncSecurityBlockedError(blocked[0].message, preflight);
    }
    await this.runGitHubCli(root, ["auth", "setup-git", "--hostname", "github.com"], [0], false);
    await this.requireGit(root);
    await this.ensureRepository(root);
    await this.ensureBranch(root);
    const existingRemote = await this.run(root, ["remote", "get-url", "origin"], [0, 2, 128]);
    if (existingRemote.code === 0 && existingRemote.stdout.trim()) {
      throw new Error("当前项目已经存在 origin 远端；请在 GitHub 同步页确认或修改现有连接。");
    }
    const fullName = `${account.login}/${repositoryName}`;
    const existingRepository = await this.runGitHubCli(root, ["repo", "view", fullName, "--json", "nameWithOwner"], [0, 1], true);
    if (existingRepository.code === 0) throw new Error(`GitHub 仓库 ${fullName} 已存在，请换一个仓库名。`);
    await this.runGitHubCli(
      root,
      ["repo", "create", fullName, `--${options.visibility}`, "--source", ".", "--remote", "origin"],
      [0],
      false
    );
    const identity = await this.gitIdentity(root);
    if (!identity.configured) {
      await this.run(root, ["config", "--local", "user.name", account.name || account.login]);
      await this.run(root, ["config", "--local", "user.email", account.email || `${account.login}@users.noreply.github.com`]);
    }
    const remoteUrl = `https://github.com/${fullName}.git`;
    await this.configure(projectId, root, {
      remoteUrl,
      autoSync: options.autoSync,
      useLfsForDocuments: options.useLfsForDocuments
    });
    const config = await this.readConfig(projectId);
    if (!config) throw new Error("仓库已创建，但本机同步配置保存失败。");
    await this.writeConfig({
      ...config,
      repositoryFullName: fullName,
      visibility: options.visibility,
      acknowledgedWarnings: preflight.filter((finding) => finding.severity === "warning").map((finding) => finding.path),
      acknowledgedTreeHash: preflightSnapshot.treeHash
    });
    return this.syncNow(projectId, root, false);
  }

  async setVisibility(
    projectId: string,
    root: string,
    visibility: GitHubRepositoryVisibility
  ): Promise<GitHubSyncStatus> {
    if (!new Set<GitHubRepositoryVisibility>(["public", "private"]).has(visibility)) {
      throw new Error("仓库可见性设置无效。");
    }
    const config = await this.readConfig(projectId);
    if (!config) throw new Error("请先连接 GitHub 仓库。");
    const account = await this.authStatus(root);
    if (!account.authenticated) throw new Error("请先在客户端设置中登录 GitHub。");
    let publicPreflight: SyncSecurityFinding[] = [];
    let publicTreeHash: string | undefined;
    if (visibility === "public") {
      await this.requireGit(root);
      await this.ensureRepository(root);
      await this.run(root, ["add", "-A", "--", "."]);
      const publicSnapshot = await this.candidateSecuritySnapshot(root, true);
      publicPreflight = publicSnapshot.findings;
      publicTreeHash = publicSnapshot.treeHash;
      const blocked = publicPreflight.filter((finding) => finding.severity === "block");
      if (blocked.length) {
        this.setLive(projectId, "blocked", blocked[0].message, "error", { securityFindings: publicPreflight });
        throw new SyncSecurityBlockedError(blocked[0].message, publicPreflight);
      }
    }
    const coordinates = repositoryCoordinates(config.remoteUrl);
    await this.runGitHubCli(
      root,
      ["repo", "edit", coordinates.fullName, "--visibility", visibility, "--accept-visibility-change-consequences"],
      [0],
      false
    );
    await this.writeConfig({
      ...config,
      repositoryFullName: coordinates.fullName,
      visibility,
      acknowledgedWarnings: visibility === "public"
        ? [...new Set([...(config.acknowledgedWarnings ?? []), ...publicPreflight.filter((finding) => finding.severity === "warning").map((finding) => finding.path)])]
        : config.acknowledgedWarnings,
      acknowledgedTreeHash: visibility === "public" ? publicTreeHash : config.acknowledgedTreeHash
    });
    this.setLive(projectId, "ready", `仓库已切换为${visibility === "public" ? "公开" : "私有"}。`, "info");
    return this.status(projectId, root);
  }

  async remoteWebUrl(projectId: string, root: string): Promise<string> {
    const config = await this.readConfig(projectId);
    let remoteUrl = config?.remoteUrl;
    if (!remoteUrl) {
      const detected = await this.run(root, ["remote", "get-url", "origin"], [0, 2, 128]);
      if (detected.code === 0) remoteUrl = detected.stdout.trim();
    }
    if (!remoteUrl) throw new Error("当前项目尚未连接 GitHub 仓库。");
    const coordinates = repositoryCoordinates(remoteUrl);
    return `https://github.com/${coordinates.fullName}`;
  }

  async syncNow(projectId: string, root: string, background = false): Promise<GitHubSyncStatus> {
    const existing = this.jobs.get(projectId);
    if (existing) {
      if (background) this.rerunAfter.add(projectId);
      return existing;
    }
    this.roots.set(projectId, resolve(root));
    const job = new Promise<GitHubSyncStatus>((resolveJob) => {
      this.queue.push({ projectId, root: resolve(root), background, resolve: resolveJob, settled: false });
      this.setLive(projectId, "queued", this.paused ? "自动同步已暂停，任务保留在队列中。" : "同步任务已加入队列。", "info");
      this.pumpQueue();
    });
    this.jobs.set(projectId, job);
    return job;
  }

  private pumpQueue(): void {
    if (this.paused) return;
    while (this.activeJobs < this.maxConcurrent && this.queue.length) {
      const queued = this.queue.shift()!;
      if (queued.settled) continue;
      this.activeJobs += 1;
      const controller = new AbortController();
      const rootKey = foldedPath(queued.root, this.platform);
      this.activeControllers.set(queued.projectId, controller);
      this.activeSignalsByRoot.set(rootKey, controller.signal);
      void this.performSync(queued.projectId, queued.root, queued.background)
        .then((status) => this.settleQueued(queued, status))
        .catch(async (error) => {
          if (!controller.signal.aborted) {
            this.setLive(
              queued.projectId,
              "error",
              error instanceof Error ? error.message : "GitHub 同步失败。",
              "error"
            );
          }
          this.settleQueued(queued, await this.cancelledStatus(queued.projectId, queued.root));
        })
        .finally(() => {
          this.activeJobs -= 1;
          this.activeControllers.delete(queued.projectId);
          if (this.activeSignalsByRoot.get(rootKey) === controller.signal) this.activeSignalsByRoot.delete(rootKey);
          this.jobs.delete(queued.projectId);
          if (this.rerunAfter.delete(queued.projectId)) this.scheduleSync(queued.projectId, 1_000);
          this.pumpQueue();
        });
    }
  }

  private settleQueued(queued: QueuedSync, status: GitHubSyncStatus): void {
    if (queued.settled) return;
    queued.settled = true;
    queued.resolve(status);
    if (!this.activeControllers.has(queued.projectId)) this.jobs.delete(queued.projectId);
  }

  private async cancelledStatus(projectId: string, root: string): Promise<GitHubSyncStatus> {
    const config = await this.readConfig(projectId);
    return {
      available: Boolean(this.executable),
      gitVersion: this.gitVersion,
      configured: Boolean(config),
      repository: existsSync(join(root, ".git")),
      lfsAvailable: this.lfsAvailable ?? false,
      remoteUrl: config?.remoteUrl ?? "",
      autoSync: config?.autoSync ?? false,
      useLfsForDocuments: config?.useLfsForDocuments ?? false,
      repositoryFullName: config?.repositoryFullName,
      visibility: config?.visibility,
      state: "ready",
      changedFiles: [],
      largeFiles: [],
      ahead: 0,
      behind: 0,
      lastSyncAt: config?.lastSyncAt,
      paused: this.paused,
      identity: emptyGitIdentity(),
      message: "同步任务已取消，本地文件没有被丢弃。"
    };
  }

  async status(projectId: string, root: string): Promise<GitHubSyncStatus> {
    this.roots.set(projectId, resolve(root));
    const config = await this.readConfig(projectId);
    const executable = await this.resolveGit(root);
    if (!executable) {
      return {
        available: false,
        configured: Boolean(config),
        repository: false,
        lfsAvailable: false,
        remoteUrl: config?.remoteUrl ?? "",
        autoSync: config?.autoSync ?? false,
        useLfsForDocuments: config?.useLfsForDocuments ?? false,
        state: "unavailable",
        changedFiles: [],
        largeFiles: [],
        ahead: 0,
        behind: 0,
        lastSyncAt: config?.lastSyncAt,
        identity: emptyGitIdentity(),
        message: "未检测到 Git。请安装 Git for Windows 或 GitHub Desktop。"
      };
    }

    const repository = await this.repositoryRoot(root);
    if (!repository) {
      return {
        available: true,
        gitVersion: this.gitVersion,
        configured: Boolean(config),
        repository: false,
        lfsAvailable: await this.probeLfs(root),
        remoteUrl: config?.remoteUrl ?? "",
        autoSync: config?.autoSync ?? false,
        useLfsForDocuments: config?.useLfsForDocuments ?? false,
        state: config ? "error" : "notConfigured",
        changedFiles: [],
        largeFiles: [],
        ahead: 0,
        behind: 0,
        lastSyncAt: config?.lastSyncAt,
        identity: await this.gitIdentity(root),
        message: config ? "项目中的 Git 仓库不可用，请重新连接。" : "尚未连接 GitHub 仓库。"
      };
    }

    const [branchResult, remoteResult, changesResult, lastCommitResult, identity] = await Promise.all([
      this.run(root, ["symbolic-ref", "--short", "HEAD"], [0, 128]),
      this.run(root, ["remote", "get-url", "origin"], [0, 2, 128]),
      this.run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      this.run(root, ["log", "-1", "--format=%h%x00%s%x00%cI"], [0, 128]),
      this.gitIdentity(root)
    ]);
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() : undefined;
    const detectedRemoteRaw = remoteResult.code === 0 ? remoteResult.stdout.trim() : "";
    let detectedRemote = "";
    if (detectedRemoteRaw) {
      try {
        // Never expose credentials embedded in an existing origin URL to the renderer.
        detectedRemote = normalizeGitHubRemoteUrl(detectedRemoteRaw);
      } catch {
        detectedRemote = "";
      }
    }
    const remoteUrl = config?.remoteUrl || detectedRemote;
    const coordinates = remoteUrl ? repositoryCoordinates(remoteUrl) : undefined;
    const changedFiles = parseChangedFiles(changesResult.stdout);
    const largeFiles = await this.largeChangedFiles(root, changedFiles);
    const { ahead, behind } = branch ? await this.aheadBehind(root, branch) : { ahead: 0, behind: 0 };
    const commitParts = lastCommitResult.code === 0 ? lastCommitResult.stdout.trim().split("\0") : [];
    const live = this.live.get(projectId);
    let state: GitHubSyncState;
    let message: string | undefined;
    if (live && new Set<GitHubSyncState>(["queued", "syncing", "retrying", "error", "needsPull", "blocked"]).has(live.state)) {
      state = live.state;
      message = live.message;
    } else if (!config) {
      state = "notConfigured";
      message = detectedRemote ? "检测到已有 origin；确认设置后即可启用自动同步。" : "尚未连接 GitHub 仓库。";
    } else if (behind > 0) {
      state = "needsPull";
      message = "远端包含本机没有的提交，已停止自动推送以防覆盖。";
    } else if (changedFiles.length || ahead > 0) {
      state = "changes";
      message = `${changedFiles.length} 个未同步文件，${ahead} 个待推送提交。`;
    } else {
      state = config.lastSyncAt ? "synced" : "ready";
      message = config.lastSyncAt ? "本机与 GitHub 已同步。" : "仓库已连接，等待首次同步。";
    }
    return {
      available: true,
      gitVersion: this.gitVersion,
      configured: Boolean(config),
      repository: true,
      lfsAvailable: await this.probeLfs(root),
      remoteUrl,
      autoSync: config?.autoSync ?? false,
      useLfsForDocuments: config?.useLfsForDocuments ?? false,
      branch,
      repositoryFullName: config?.repositoryFullName ?? coordinates?.fullName,
      visibility: config?.visibility,
      state,
      changedFiles,
      largeFiles,
      ahead,
      behind,
      lastSyncAt: config?.lastSyncAt,
      nextRetryAt: live?.nextRetryAt,
      paused: this.paused,
      securityFindings: live?.securityFindings,
      identity,
      lastCommit: commitParts.length >= 3 ? { hash: commitParts[0], message: commitParts[1], committedAt: commitParts[2] } : undefined,
      message
    };
  }

  private async performSync(projectId: string, root: string, background: boolean): Promise<GitHubSyncStatus> {
    let config: StoredSyncConfig | null = null;
    try {
      config = await this.readConfig(projectId);
      if (!config) throw new Error("请先连接 GitHub 仓库。");
      this.setLive(projectId, "syncing", "正在检查本机变更与 GitHub 状态…", "info");
      await this.requireGit(root);
      await this.ensureRepository(root);
      const branch = await this.ensureBranch(root);
      let changes = parseChangedFiles((await this.run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout);
      let findings: SyncSecurityFinding[] = [];

      const remoteBranch = await this.run(root, ["ls-remote", "--exit-code", "--heads", "origin", branch], [0, 2], background);
      if (remoteBranch.code === 0) {
        await this.run(root, ["fetch", "--prune", "origin", branch], [0], background);
        const relation = await this.aheadBehind(root, branch);
        const remoteAction = decideSafeRemoteAction(relation.ahead, relation.behind, changes.length);
        if (remoteAction === "blocked") {
          throw new SyncNeedsPullError("GitHub 上存在较新的提交，同时本机也有变更；已暂停同步，请先处理两端差异。");
        }
        if (remoteAction === "fastForward") {
          this.setLive(projectId, "syncing", "本机工作区干净，正在安全快进到 GitHub 最新版本…", "info");
          await this.run(root, ["pull", "--ff-only", "origin", branch], [0], background);
          changes = parseChangedFiles((await this.run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout);
        }
      }

      await this.run(root, ["add", "-A", "--", "."]);
      const candidate = await this.candidateSecuritySnapshot(root, false);
      findings = candidate.findings;
      const hardBlocks = findings.filter((finding) => finding.severity === "block");
      if (hardBlocks.length) throw new SyncSecurityBlockedError(hardBlocks[0].message, findings);
      const acknowledged = config.acknowledgedTreeHash === candidate.treeHash
        ? new Set(config.acknowledgedWarnings ?? [])
        : new Set<string>();
      const warnings = findings.filter((finding) => finding.severity === "warning" && !acknowledged.has(finding.path));
      if (warnings.length) {
        throw new SyncWarningApprovalError("发现需要确认的敏感文件或大文件，确认前不会上传。", findings);
      }
      const finalCandidateTree = (await this.run(root, ["write-tree"])).stdout.trim();
      if (finalCandidateTree !== candidate.treeHash) {
        throw new SyncWarningApprovalError("候选树在确认后发生变化；安全确认已作废，请重新检查。", findings);
      }
      const staged = await this.run(root, ["diff", "--cached", "--quiet"], [0, 1]);
      if (staged.code === 1) {
        const identity = await this.gitIdentity(root);
        if (!identity.configured) {
          throw new Error("Git 尚未设置提交姓名或邮箱；请在本页的“提交身份”中填写并保存。");
        }
        const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
        await this.commitCandidateTree(root, branch, candidate.treeHash, `自动同步：${timestamp}`);
      }

      await this.run(root, ["push", "-u", "origin", branch], [0], background);
      const lastSyncAt = new Date().toISOString();
      await this.writeConfig({
        ...config,
        lastSyncAt,
        lastError: undefined,
        acknowledgedWarnings: [],
        acknowledgedTreeHash: undefined
      });
      const retryTimer = this.retryTimers.get(projectId);
      if (retryTimer) clearTimeout(retryTimer);
      this.retryTimers.delete(projectId);
      this.retryAttempts.delete(projectId);
      this.setLive(projectId, "synced", "新增、修改和删除内容均已同步到 GitHub。", "info", {
        securityFindings: findings.filter((finding) => finding.severity === "warning")
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub 同步失败。";
      if (error instanceof Error && error.name === "AbortError") {
        this.activeSignalsByRoot.delete(foldedPath(root, this.platform));
        this.setLive(
          projectId,
          this.paused ? "queued" : "ready",
          this.paused ? "同步已暂停，本地变更仍安全保留。" : "同步任务已取消，本地变更仍安全保留。",
          "info"
        );
        return this.cancelledStatus(projectId, root);
      }
      if (error instanceof SyncSecurityBlockedError || error instanceof SyncWarningApprovalError) {
        this.setLive(projectId, "blocked", message, error instanceof SyncSecurityBlockedError ? "error" : "warning", {
          securityFindings: error.findings
        });
      } else if (error instanceof SyncNeedsPullError) {
        this.setLive(projectId, "needsPull", message, "warning");
      } else if (retryableNetworkError(message) && config?.autoSync) {
        this.scheduleRetry(projectId, message);
      } else {
        this.setLive(projectId, "error", message, "error");
      }
      if (config) await this.writeConfig({ ...config, lastError: message });
    }
    return this.status(projectId, root);
  }

  private scheduleRetry(projectId: string, reason: string): void {
    const previous = this.retryTimers.get(projectId);
    if (previous) clearTimeout(previous);
    const attempt = this.retryAttempts.get(projectId) ?? 0;
    if (attempt >= this.retryDelaysMs.length) {
      this.retryAttempts.delete(projectId);
      this.setLive(projectId, "error", `网络重试 ${this.retryDelaysMs.length} 次后仍然失败：${reason}`, "error");
      return;
    }
    const delay = this.retryDelaysMs[Math.min(attempt, this.retryDelaysMs.length - 1)];
    this.retryAttempts.set(projectId, attempt + 1);
    const nextRetryAt = new Date(Date.now() + delay).toISOString();
    this.setLive(projectId, "retrying", `网络暂时不可用，将自动重试：${reason}`, "warning", { nextRetryAt });
    const timer = setTimeout(() => {
      this.retryTimers.delete(projectId);
      const root = this.roots.get(projectId);
      if (root && !this.paused) void this.syncNow(projectId, root, true);
    }, delay);
    timer.unref();
    this.retryTimers.set(projectId, timer);
  }

  private async resolveGit(cwd: string): Promise<string | null> {
    if (this.executable !== undefined) return this.executable;
    const programFiles = this.env.ProgramFiles;
    const localAppData = this.env.LOCALAPPDATA;
    const candidates = [
      this.env.GIT_EXECUTABLE,
      programFiles ? join(programFiles, "Git", "cmd", "git.exe") : undefined,
      localAppData ? join(localAppData, "Programs", "Git", "cmd", "git.exe") : undefined,
      "git"
    ].filter((item): item is string => Boolean(item));
    for (const candidate of candidates) {
      if (isAbsolute(candidate) && !existsSync(candidate)) continue;
      try {
        const result = await this.runner(candidate, cwd, this.safeArgs(cwd, ["--version"]), { background: true });
        if (result.code === 0 && /^git version /i.test(result.stdout.trim())) {
          this.executable = candidate;
          this.gitVersion = result.stdout.trim().replace(/^git version\s+/i, "");
          return candidate;
        }
      } catch {
        // Try the next known installation.
      }
    }
    this.executable = null;
    return null;
  }

  private async resolveGitHubCli(cwd: string): Promise<string | null> {
    if (this.githubCliExecutable !== undefined) return this.githubCliExecutable;
    const programFiles = this.env.ProgramFiles;
    const programW6432 = this.env.ProgramW6432;
    const localAppData = this.env.LOCALAPPDATA;
    const candidates = [
      this.env.GITHUB_CLI_EXECUTABLE,
      programFiles ? join(programFiles, "GitHub CLI", "gh.exe") : undefined,
      programW6432 ? join(programW6432, "GitHub CLI", "gh.exe") : undefined,
      localAppData ? join(localAppData, "Programs", "GitHub CLI", "gh.exe") : undefined,
      "gh"
    ].filter((item): item is string => Boolean(item));
    for (const candidate of candidates) {
      if (isAbsolute(candidate) && !existsSync(candidate)) continue;
      try {
        const result = await this.runner(candidate, cwd, ["--version"], { background: true });
        if (result.code === 0 && /^gh version /i.test(result.stdout.trim())) {
          this.githubCliExecutable = candidate;
          this.githubCliVersion = result.stdout.trim().split(/\r?\n/, 1)[0].replace(/^gh version\s+/i, "");
          return candidate;
        }
      } catch {
        // Try the next known installation.
      }
    }
    this.githubCliExecutable = null;
    return null;
  }

  private async requireGit(cwd: string): Promise<string> {
    const executable = await this.resolveGit(cwd);
    if (!executable) throw new Error("未检测到 Git。请安装 Git for Windows 或 GitHub Desktop。");
    return executable;
  }

  private managedHooksDirectory(root: string): string {
    const key = createHash("sha256").update(foldedPath(root, this.platform)).digest("hex");
    return join(this.configDirectory, "git-hooks", key);
  }

  private safeArgs(root: string, args: string[]): string[] {
    // A real isolated directory keeps project-provided hooks disabled while still
    // allowing Git LFS to install and run its required pre-push hook. Windows'
    // NUL device cannot be used here because Git LFS treats core.hooksPath as a
    // directory and attempts to create it.
    const hooksDirectory = portablePath(this.managedHooksDirectory(root));
    return ["-c", `core.hooksPath=${hooksDirectory}`, ...args];
  }

  private async run(cwd: string, args: string[], allowedCodes = [0], background = true): Promise<GitCommandResult> {
    const executable = await this.requireGit(cwd);
    const signal = this.activeSignalsByRoot.get(foldedPath(cwd, this.platform));
    const result = await this.runner(executable, cwd, this.safeArgs(cwd, args), { background, signal });
    if (!allowedCodes.includes(result.code)) throw new Error(conciseError(result));
    return result;
  }

  private async runGitHubCli(
    cwd: string,
    args: string[],
    allowedCodes = [0],
    background = true
  ): Promise<GitCommandResult> {
    const executable = await this.resolveGitHubCli(cwd);
    if (!executable) throw new Error("未检测到 GitHub CLI。请先安装后再登录 GitHub。");
    const result = await this.runner(executable, cwd, args, { background });
    if (!allowedCodes.includes(result.code)) throw new Error(conciseError(result));
    return result;
  }

  private async repositoryRoot(root: string): Promise<string | null> {
    const result = await this.run(root, ["rev-parse", "--show-toplevel"], [0, 128]);
    if (result.code !== 0) return null;
    const found = resolve(result.stdout.trim());
    return foldedPath(found, this.platform) === foldedPath(root, this.platform) ? found : null;
  }

  private async ensureRepository(root: string): Promise<void> {
    if (await this.repositoryRoot(root)) return;
    await this.run(root, ["init"]);
    const repository = await this.repositoryRoot(root);
    if (!repository) throw new Error("无法在项目根目录建立独立 Git 仓库。");
  }

  private async ensureBranch(root: string): Promise<string> {
    const branch = await this.run(root, ["symbolic-ref", "--short", "HEAD"], [0, 128]);
    if (branch.code === 0 && branch.stdout.trim()) return branch.stdout.trim();
    const head = await this.run(root, ["rev-parse", "--verify", "HEAD"], [0, 128]);
    if (head.code !== 0) {
      await this.run(root, ["symbolic-ref", "HEAD", "refs/heads/main"]);
      return "main";
    }
    throw new Error("当前仓库处于 detached HEAD 状态，不能自动同步。");
  }

  private async probeLfs(root: string): Promise<boolean> {
    if (this.lfsAvailable !== undefined) return this.lfsAvailable;
    try {
      const result = await this.run(root, ["lfs", "version"], [0, 1, 128]);
      this.lfsAvailable = result.code === 0;
    } catch {
      this.lfsAvailable = false;
    }
    return this.lfsAvailable;
  }

  private async aheadBehind(root: string, branch: string): Promise<{ ahead: number; behind: number }> {
    const reference = await this.run(root, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], [0, 1]);
    if (reference.code !== 0) return { ahead: 0, behind: 0 };
    const result = await this.run(root, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]);
    const [ahead, behind] = result.stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
    return {
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0
    };
  }

  private async gitIdentity(root: string): Promise<GitIdentity> {
    const [localName, localEmail, effectiveName, effectiveEmail] = await Promise.all([
      this.run(root, ["config", "--local", "--get", "user.name"], [0, 1, 128]),
      this.run(root, ["config", "--local", "--get", "user.email"], [0, 1, 128]),
      this.run(root, ["config", "--get", "user.name"], [0, 1, 128]),
      this.run(root, ["config", "--get", "user.email"], [0, 1, 128])
    ]);
    const name = effectiveName.code === 0 ? effectiveName.stdout.trim() : "";
    const email = effectiveEmail.code === 0 ? effectiveEmail.stdout.trim() : "";
    const hasLocalValue = localName.code === 0 || localEmail.code === 0;
    return {
      name,
      email,
      configured: Boolean(name && email),
      source: name || email ? (hasLocalValue ? "local" : "global") : "none"
    };
  }

  private async commitCandidateTree(root: string, branch: string, treeHash: string, message: string): Promise<void> {
    const head = await this.run(root, ["rev-parse", "--verify", "HEAD"], [0, 128]);
    const oldHead = head.code === 0 ? head.stdout.trim() : "";
    if (oldHead && !/^[a-f0-9]{40,64}$/i.test(oldHead)) throw new Error("当前 Git HEAD 无效，已停止自动提交。");
    const argumentsList = ["commit-tree", treeHash];
    if (oldHead) argumentsList.push("-p", oldHead);
    argumentsList.push("-m", message);
    const committed = (await this.run(root, argumentsList)).stdout.trim();
    if (!/^[a-f0-9]{40,64}$/i.test(committed)) throw new Error("无法创建经过安全扫描的提交。");
    const reference = `refs/heads/${branch}`;
    const updateArgs = oldHead
      ? ["update-ref", reference, committed, oldHead]
      : ["update-ref", reference, committed];
    await this.run(root, updateArgs);
  }

  private async candidateSecuritySnapshot(root: string, includeTracked: boolean): Promise<CandidateSecuritySnapshot> {
    const tree = (await this.run(root, ["write-tree"])).stdout.trim();
    if (!/^[a-f0-9]{40,64}$/i.test(tree)) throw new Error("无法生成待同步候选树。请检查 Git 索引后重试。");

    const listed = await this.run(root, ["ls-files", "--stage", "-z"]);
    const entries = new Map<string, { objectId: string; size?: number }>();
    for (const record of listed.stdout.split("\0").filter(Boolean)) {
      const tab = record.indexOf("\t");
      if (tab < 0) continue;
      const metadata = record.slice(0, tab).trim().split(/\s+/);
      if (metadata.length < 3 || metadata[2] !== "0" || !/^[a-f0-9]{40,64}$/i.test(metadata[1])) continue;
      entries.set(portablePath(record.slice(tab + 1)), { objectId: metadata[1] });
    }

    const changes = includeTracked
      ? [...entries.keys()].map((path) => ({ path, status: "  " }))
      : parseChangedFiles((await this.run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout);
    const largeFiles: GitHubLargeFile[] = [];
    for (const change of changes) {
      if (change.status.includes("D")) continue;
      const entry = entries.get(change.path);
      if (!entry) continue;
      const sizeResult = await this.run(root, ["cat-file", "-s", entry.objectId]);
      const size = Number.parseInt(sizeResult.stdout.trim(), 10);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error(`无法读取候选文件大小：${change.path}`);
      entry.size = size;
      if (size < LARGE_FILE_WARNING) continue;
      const attribute = await this.run(root, ["check-attr", "--cached", "filter", "--", change.path]);
      largeFiles.push({
        path: change.path,
        size,
        trackedByLfs: /:\s*filter:\s*lfs\s*$/i.test(attribute.stdout.trim())
      });
    }

    const findings = await scanSyncSecuritySnapshot(changes, largeFiles, async (path) => {
      const entry = entries.get(path);
      if (!entry || (entry.size ?? Number.POSITIVE_INFINITY) > 2 * 1024 * 1024) return null;
      const blob = await this.run(root, ["cat-file", "blob", entry.objectId]);
      return Buffer.from(blob.stdout, "utf8");
    });
    const verifiedTree = (await this.run(root, ["write-tree"])).stdout.trim();
    if (verifiedTree !== tree) throw new Error("安全检查期间候选树发生变化，已停止同步；请重新检查后再试。");
    return { treeHash: tree, changes, largeFiles, findings };
  }

  private async largeChangedFiles(root: string, changes: GitHubChangedFile[]): Promise<GitHubLargeFile[]> {
    const result: GitHubLargeFile[] = [];
    for (const change of changes) {
      if (change.status.includes("D")) continue;
      const candidate = resolve(root, change.path);
      if (!isInside(root, candidate)) throw new Error(`Git 返回了项目外路径：${change.path}`);
      let metadata;
      try {
        metadata = await lstat(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (metadata.isSymbolicLink()) throw new Error(`自动同步拒绝符号链接：${change.path}`);
      if (!metadata.isFile() || metadata.size < LARGE_FILE_WARNING) continue;
      const attribute = await this.run(root, ["check-attr", "filter", "--", change.path]);
      result.push({
        path: change.path,
        size: metadata.size,
        trackedByLfs: /:\s*filter:\s*lfs\s*$/i.test(attribute.stdout.trim())
      });
    }
    return result;
  }

  private configPath(projectId: string): string {
    const key = createHash("sha256").update(projectId).digest("hex");
    return join(this.configDirectory, `${key}.json`);
  }

  private async readConfig(projectId: string): Promise<StoredSyncConfig | null> {
    try {
      const value = JSON.parse(await readFile(this.configPath(projectId), "utf8")) as Partial<StoredSyncConfig>;
      if (value.schemaVersion !== CONFIG_VERSION || value.projectId !== projectId || typeof value.remoteUrl !== "string"
        || typeof value.autoSync !== "boolean" || typeof value.useLfsForDocuments !== "boolean") return null;
      if (value.visibility !== undefined && value.visibility !== "public" && value.visibility !== "private") return null;
      if (value.repositoryFullName !== undefined && (typeof value.repositoryFullName !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repositoryFullName))) return null;
      if (value.acknowledgedWarnings !== undefined && (!Array.isArray(value.acknowledgedWarnings) || value.acknowledgedWarnings.some((path) => typeof path !== "string"))) return null;
      if (value.acknowledgedTreeHash !== undefined && (typeof value.acknowledgedTreeHash !== "string" || !/^[a-f0-9]{40,64}$/i.test(value.acknowledgedTreeHash))) return null;
      return value as StoredSyncConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async writeConfig(config: StoredSyncConfig): Promise<void> {
    await mkdir(this.configDirectory, { recursive: true });
    const destination = this.configPath(config.projectId);
    const temporary = `${destination}.${randomBytes(5).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  }

  private async startWatcher(projectId: string): Promise<void> {
    if (this.watchers.has(projectId)) return;
    const root = this.roots.get(projectId);
    if (!root || !existsSync(root)) return;
    this.watchers.set(projectId, this.watcherFactory(root, () => this.scheduleSync(projectId)));
    const pollTimer = setInterval(() => this.scheduleSync(projectId, 1_000), 60_000);
    pollTimer.unref();
    this.pollTimers.set(projectId, pollTimer);
  }

  private async stopWatcher(projectId: string): Promise<void> {
    const timer = this.timers.get(projectId);
    if (timer) clearTimeout(timer);
    this.timers.delete(projectId);
    const pollTimer = this.pollTimers.get(projectId);
    if (pollTimer) clearInterval(pollTimer);
    this.pollTimers.delete(projectId);
    const watcher = this.watchers.get(projectId);
    this.watchers.delete(projectId);
    if (watcher) await watcher.close();
  }

  private scheduleSync(projectId: string, delay = this.debounceMs): void {
    const current = this.timers.get(projectId);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      this.timers.delete(projectId);
      const root = this.roots.get(projectId);
      if (root) void this.syncNow(projectId, root, true);
    }, delay);
    timer.unref();
    this.timers.set(projectId, timer);
  }
}
