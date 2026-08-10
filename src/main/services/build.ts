import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  BuildEvent,
  BuildProblem,
  BuildRequest,
  DocumentTarget,
  Engine,
  ProjectManifest,
  ToolchainInfo
} from "../../shared/types";
import { readProjectManifest } from "./manifest";
import { BuildLogParser } from "./log-parser";
import { resolveProjectPath } from "./files";
import { createProfileRuntime, profileBuildDirectoryPath, type ProfileRuntimeResult } from "./profile-runtime";
import { isAbsoluteToolCommand, resolveToolchain } from "./toolchain";

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type ManifestReader = (projectRoot: string) => Promise<ProjectManifest>;
type ToolchainResolver = (preferred?: string) => Promise<ToolchainInfo | null>;
type RuntimeFactory = typeof createProfileRuntime;

interface BuildRecord {
  request: BuildRequest;
  event: BuildEvent;
  parser: BuildLogParser;
  problems: BuildProblem[];
  child?: ChildProcess;
  cancelled: boolean;
  finished: boolean;
}

export interface BuildServiceOptions {
  spawnProcess?: SpawnProcess;
  readManifest?: ManifestReader;
  resolveToolchain?: ToolchainResolver;
  createRuntime?: RuntimeFactory;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  createBuildId?: () => string;
}

function fileExists(path: string): Promise<boolean> {
  return stat(path).then((metadata) => metadata.isFile(), () => false);
}

function texExecutable(toolchain: ToolchainInfo, engine: Exclude<Engine, "auto">): string | undefined {
  return toolchain[engine];
}

export function selectBuildEngine(
  target: DocumentTarget,
  toolchain: ToolchainInfo,
  source = ""
): Exclude<Engine, "auto"> {
  if (target.engine !== "auto") return target.engine;
  const magic = source.match(/^\s*%+\s*!\s*TeX\s+program\s*=\s*(xe|lua|pdf)latex\b/im)?.[1]?.toLowerCase();
  if (magic === "xe") return "xelatex";
  if (magic === "lua") return "lualatex";
  if (magic === "pdf") return "pdflatex";
  if (toolchain.xelatex) return "xelatex";
  if (toolchain.lualatex) return "lualatex";
  return "pdflatex";
}

function latexmkEngineFlag(engine: Exclude<Engine, "auto">): string {
  if (engine === "xelatex") return "-pdfxe";
  if (engine === "lualatex") return "-pdflua";
  return "-pdf";
}

function latexmkEngineOverride(engine: Exclude<Engine, "auto">, executable: string): string {
  const portableExecutable = executable.replace(/\\/g, "/").replace(/'/g, "\\'");
  return `$${engine} = '\"${portableExecutable}\" %O %S'`;
}

export function buildLatexmkArguments(
  runtime: ProfileRuntimeResult,
  engine: Exclude<Engine, "auto">,
  engineExecutable: string,
  shellEscape = false
): string[] {
  const args = [
    "-interaction=nonstopmode",
    "-norc",
    "-file-line-error",
    "-synctex=1",
    "-halt-on-error",
    latexmkEngineFlag(engine),
    `-outdir=${runtime.buildDirectory}`,
    `-auxdir=${runtime.buildDirectory}`,
    "-jobname=workbench",
    "-e",
    latexmkEngineOverride(engine, engineExecutable)
  ];
  if (shellEscape) args.push("-shell-escape");
  args.push(runtime.wrapperPath);
  return args;
}

async function replaceFile(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryExists = false;
  try {
    await copyFile(source, temporary);
    temporaryExists = true;
    await rename(temporary, destination);
    temporaryExists = false;
  } finally {
    if (temporaryExists) await rm(temporary, { force: true });
  }
}

export function remapSyncTexInputText(text: string, generatedEntryPath: string, originalEntryPath: string): string {
  const generated = generatedEntryPath.replace(/\\/g, "/").replace(/\/\.\//g, "/").toLocaleLowerCase("en-US");
  const original = originalEntryPath.replace(/\\/g, "/");
  return text.split(/\r?\n/).map((line) => {
    const match = /^Input:(\d+):(.*)$/.exec(line);
    if (!match) return line;
    const candidate = match[2].replace(/\/\.\//g, "/").toLocaleLowerCase("en-US");
    return candidate === generated ? `Input:${match[1]}:${original}` : line;
  }).join("\n");
}

async function remapSyncTexEntry(syncTexPath: string, generatedEntryPath: string, originalEntryPath: string): Promise<void> {
  try {
    const compressed = await readFile(syncTexPath);
    const text = gunzipSync(compressed).toString("utf8");
    const rewritten = remapSyncTexInputText(text, generatedEntryPath, originalEntryPath);
    if (rewritten === text) return;
    const temporary = `${syncTexPath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryExists = false;
    try {
      await writeFile(temporary, gzipSync(Buffer.from(rewritten, "utf8")));
      temporaryExists = true;
      await rename(temporary, syncTexPath);
      temporaryExists = false;
    } finally {
      if (temporaryExists) await rm(temporary, { force: true });
    }
  } catch {
    // A missing/corrupt optional SyncTeX file must not turn a valid PDF build into a failure.
  }
}

function processEnvironment(
  projectRoot: string,
  buildDirectory: string,
  toolchain: ToolchainInfo,
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const portableRoot = projectRoot.replace(/\\/g, "/");
  const portableBuild = buildDirectory.replace(/\\/g, "/");
  const appendDefault = (existing: string | undefined): string =>
    `${portableBuild}//${delimiter}${portableRoot}//${delimiter}${existing ?? ""}`;
  const pinnedPath = `${toolchain.binPath}${delimiter}${base.PATH ?? base.Path ?? ""}`;
  return {
    ...base,
    PATH: pinnedPath,
    Path: pinnedPath,
    TEXINPUTS: appendDefault(base.TEXINPUTS),
    BIBINPUTS: appendDefault(base.BIBINPUTS),
    BSTINPUTS: appendDefault(base.BSTINPUTS)
  };
}

function defaultTerminate(child: ChildProcess, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<void> {
  if (!child.pid) {
    child.kill();
    return Promise.resolve();
  }
  if (platform === "win32") {
    const taskkill = join(env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    return new Promise((resolveTermination) => {
      execFile(taskkill, ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolveTermination());
    });
  }

  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 1_500);
  timer.unref();
  return Promise.resolve();
}

export class BuildService extends EventEmitter {
  private readonly records = new Map<string, BuildRecord>();
  private readonly spawnProcess: SpawnProcess;
  private readonly readManifest: ManifestReader;
  private readonly toolchainResolver: ToolchainResolver;
  private readonly runtimeFactory: RuntimeFactory;
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly now: () => Date;
  private readonly createBuildId: () => string;

  constructor(options: BuildServiceOptions = {}) {
    super();
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.readManifest = options.readManifest ?? readProjectManifest;
    this.toolchainResolver = options.resolveToolchain ?? ((preferred) => resolveToolchain(preferred));
    this.runtimeFactory = options.createRuntime ?? createProfileRuntime;
    this.platform = options.platform ?? process.platform;
    this.environment = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.createBuildId = options.createBuildId ?? randomUUID;
  }

  onEvent(listener: (event: BuildEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  async start(request: BuildRequest): Promise<string> {
    const projectRoot = resolve(request.projectRoot);
    for (const [id, record] of this.records) {
      if (
        !record.finished &&
        resolve(record.request.projectRoot) === projectRoot &&
        record.request.targetId === request.targetId &&
        record.request.profileId === request.profileId
      ) {
        await this.cancel(id);
      }
    }

    const buildId = this.createBuildId();
    const event: BuildEvent = {
      buildId,
      projectRoot,
      status: "queued",
      targetId: request.targetId,
      profileId: request.profileId
    };
    const record: BuildRecord = {
      request: { ...request, projectRoot },
      event,
      parser: new BuildLogParser(),
      problems: [],
      cancelled: false,
      finished: false
    };
    this.records.set(buildId, record);
    this.publish(record);
    void this.execute(buildId, record);
    return buildId;
  }

  async cancel(buildId: string): Promise<void> {
    const record = this.records.get(buildId);
    if (!record || record.finished) return;
    record.cancelled = true;
    if (record.child) await defaultTerminate(record.child, this.platform, this.environment);
    if (!record.finished) this.finish(record, { status: "cancelled" });
  }

  status(buildId: string): BuildEvent | undefined;
  status(): BuildEvent[];
  status(buildId?: string): BuildEvent | BuildEvent[] | undefined {
    if (buildId) {
      const event = this.records.get(buildId)?.event;
      return event ? { ...event, problems: event.problems ? [...event.problems] : undefined } : undefined;
    }
    return [...this.records.values()].map(({ event }) => ({
      ...event,
      problems: event.problems ? [...event.problems] : undefined
    }));
  }

  private async execute(buildId: string, record: BuildRecord): Promise<void> {
    try {
      const manifest = await this.readManifest(record.request.projectRoot);
      if (record.cancelled) return;
      const target = manifest.targets.find((candidate) => candidate.id === record.request.targetId);
      if (!target) throw new Error(`Unknown document target: ${record.request.targetId}`);
      const profile = target.profiles.find((candidate) => candidate.id === record.request.profileId);
      if (!profile) throw new Error(`Unknown build profile: ${record.request.profileId}`);

      const [toolchain, entrySource] = await Promise.all([
        this.toolchainResolver(target.texDistribution),
        readFile(resolveProjectPath(record.request.projectRoot, target.entry), "utf8")
      ]);
      if (record.cancelled) return;
      if (!toolchain || !isAbsoluteToolCommand(toolchain.latexmk)) {
        throw new Error("latexmk was not found in an absolute, configured TeX distribution path.");
      }
      const engine = selectBuildEngine(target, toolchain, entrySource);
      const engineCommand = texExecutable(toolchain, engine);
      if (!engineCommand || !isAbsolute(engineCommand)) {
        throw new Error(`${engine} is unavailable in ${toolchain.binPath}.`);
      }

      const runtime = await this.runtimeFactory(record.request.projectRoot, target, profile, {
        focusNodes: record.request.focusNodes
      });
      if (record.cancelled) return;
      for (const warning of runtime.warnings) {
        record.problems.push({ severity: "warning", message: warning });
      }

      const startedAt = this.now().toISOString();
      record.event = { ...record.event, status: "running", startedAt, problems: [...record.problems] };
      this.publish(record);
      const args = buildLatexmkArguments(runtime, engine, engineCommand, record.request.shellEscape === true);
      const child = this.spawnProcess(toolchain.latexmk, args, {
        cwd: runtime.buildDirectory,
        env: processEnvironment(record.request.projectRoot, runtime.buildDirectory, toolchain, this.environment),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      record.child = child;

      const consume = (chunk: unknown): void => {
        if (record.finished) return;
        const logChunk = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        const parsed = record.parser.push(logChunk);
        if (parsed.length) record.problems.push(...parsed);
        record.event = { ...record.event, problems: [...record.problems] };
        this.publish(record, { logChunk, problems: parsed.length ? parsed : undefined });
      };
      child.stdout?.on("data", consume);
      child.stderr?.on("data", consume);

      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolveExit) => {
        let settled = false;
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          resolveExit({ code: null, signal: null, error });
        });
        child.once("close", (code, signal) => {
          if (settled) return;
          settled = true;
          resolveExit({ code, signal });
        });
      });
      if (record.finished || record.cancelled) return;
      record.problems.push(...record.parser.finish());

      const outputPdf = join(runtime.buildDirectory, "workbench.pdf");
      const outputSyncTex = join(runtime.buildDirectory, "workbench.synctex.gz");
      const lastSuccessPdf = join(runtime.buildDirectory, "last-success.pdf");
      const lastSuccessSyncTex = join(runtime.buildDirectory, "last-success.synctex.gz");
      if (result.error) {
        record.problems.push({ severity: "error", message: result.error.message });
      }

      const hasParsedErrors = record.problems.some((problem) => problem.severity === "error");
      if (result.code === 0 && !hasParsedErrors && await fileExists(outputPdf)) {
        await mkdir(runtime.buildDirectory, { recursive: true });
        if (await fileExists(outputSyncTex)) {
          await remapSyncTexEntry(outputSyncTex, runtime.generatedEntryPath, runtime.originalEntryPath);
        }
        await replaceFile(outputPdf, lastSuccessPdf);
        const hasSyncTex = await fileExists(outputSyncTex);
        if (hasSyncTex) await replaceFile(outputSyncTex, lastSuccessSyncTex);
        else await rm(lastSuccessSyncTex, { force: true });
        const hasWarnings = record.problems.some((problem) => problem.severity === "warning");
        this.finish(record, {
          status: hasWarnings ? "warning" : "success",
          pdfPath: outputPdf,
          synctexPath: hasSyncTex ? outputSyncTex : undefined,
          stalePdf: false
        });
        return;
      }

      if (!record.problems.some((problem) => problem.severity === "error")) {
        const detail = result.signal ? ` (signal ${result.signal})` : "";
        record.problems.push({ severity: "error", message: `latexmk exited with code ${result.code ?? "unknown"}${detail}.` });
      }
      const stalePdf = await fileExists(lastSuccessPdf);
      const staleSyncTex = await fileExists(lastSuccessSyncTex);
      this.finish(record, {
        status: "failed",
        pdfPath: stalePdf ? lastSuccessPdf : undefined,
        synctexPath: stalePdf && staleSyncTex ? lastSuccessSyncTex : undefined,
        stalePdf
      });
    } catch (error) {
      if (record.finished || record.cancelled) return;
      record.problems.push({ severity: "error", message: error instanceof Error ? error.message : String(error) });
      const staleDirectory = profileBuildDirectoryPath(record.request.projectRoot, record.request.targetId, record.request.profileId);
      const stalePdfPath = join(staleDirectory, "last-success.pdf");
      const staleSyncTexPath = join(staleDirectory, "last-success.synctex.gz");
      const stalePdf = await fileExists(stalePdfPath);
      const staleSyncTex = stalePdf && await fileExists(staleSyncTexPath);
      this.finish(record, {
        status: "failed",
        pdfPath: stalePdf ? stalePdfPath : undefined,
        synctexPath: staleSyncTex ? staleSyncTexPath : undefined,
        stalePdf
      });
    } finally {
      if (this.records.get(buildId) === record) record.child = undefined;
    }
  }

  private finish(record: BuildRecord, patch: Partial<BuildEvent>): void {
    if (record.finished) return;
    record.finished = true;
    record.event = {
      ...record.event,
      ...patch,
      finishedAt: this.now().toISOString(),
      problems: [...record.problems]
    };
    this.publish(record);
  }

  private publish(record: BuildRecord, transient: Partial<BuildEvent> = {}): void {
    this.emit("event", {
      ...record.event,
      ...transient,
      problems: transient.problems ?? (record.event.problems ? [...record.event.problems] : undefined)
    } satisfies BuildEvent);
  }
}
