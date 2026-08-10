import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildEvent, BuildRequest, ProjectManifest, ToolchainInfo } from "../src/shared/types";
import { BuildService } from "../src/main/services/build";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fakeChild(run: (stdout: PassThrough, stderr: PassThrough, child: ChildProcess) => Promise<void>): ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: null,
    stdio: [null, stdout, stderr, null, null],
    pid: 12345,
    killed: false,
    connected: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: "latexmk",
    kill: vi.fn(() => true),
    ref: vi.fn(),
    unref: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn()
  }) as unknown as ChildProcess;
  queueMicrotask(() => void run(stdout, stderr, child));
  return child;
}

function manifest(): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId: "project",
    name: "Book",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assets: [],
    targets: [{
      id: "target",
      name: "Book",
      entry: "main.tex",
      engine: "xelatex",
      classConfig: { name: "book", options: {}, rawOptions: [] },
      packages: [],
      structure: [],
      profiles: [{
        id: "profile",
        name: "Full",
        chapterState: {},
        numbering: "preserve",
        enabledBlocks: {},
        order: []
      }]
    }]
  };
}

async function waitForBuild(service: BuildService, request: BuildRequest): Promise<{ id: string; final: BuildEvent; events: BuildEvent[] }> {
  const events: BuildEvent[] = [];
  const unsubscribe = service.onEvent((event) => events.push(event));
  const id = await service.start(request);
  const current = service.status(id);
  if (current && ["success", "warning", "failed", "cancelled"].includes(current.status)) {
    unsubscribe();
    return { id, final: current, events };
  }
  const final = await new Promise<BuildEvent>((resolveFinal) => {
    const off = service.onEvent((event) => {
      if (event.buildId === id && ["success", "warning", "failed", "cancelled"].includes(event.status)) {
        off();
        resolveFinal(event);
      }
    });
  });
  unsubscribe();
  return { id, final, events };
}

describe("BuildService", () => {
  it("streams output with shell disabled and retains the last successful PDF after failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-workbench-build-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "main.tex"), "\\documentclass{book}\n\\begin{document}x\\end{document}\n", "utf8");
    const buildDirectory = join(root, ".latex-workbench", "build", "target", "profile");
    const runtime = {
      buildDirectory,
      runtimePath: join(buildDirectory, "runtime.tex"),
      wrapperPath: join(buildDirectory, "wrapper.tex"),
      latexmkrcPath: join(buildDirectory, ".latexmkrc"),
      generatedEntryPath: join(buildDirectory, "entry.tex"),
      originalEntryPath: join(root, "main.tex"),
      renderedStructure: "",
      warnings: []
    };
    const tools: ToolchainInfo = {
      name: "texlive",
      version: "2026",
      binPath: join(root, "texlive", "2026", "bin", "windows"),
      latexmk: join(root, "texlive", "2026", "bin", "windows", "latexmk.exe"),
      xelatex: join(root, "texlive", "2026", "bin", "windows", "xelatex.exe")
    };
    const invocations: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
    let attempt = 0;
    const service = new BuildService({
      readManifest: async () => manifest(),
      resolveToolchain: async () => tools,
      createRuntime: async () => runtime,
      spawnProcess: (command, args, options) => {
        invocations.push({ command, args, options });
        attempt += 1;
        return fakeChild(async (stdout, _stderr, child) => {
          await mkdir(buildDirectory, { recursive: true });
          if (attempt === 1) {
            stdout.write("main.tex:2: LaTeX Warning: Citation undefined.\n");
            await writeFile(join(buildDirectory, "workbench.pdf"), "%PDF-1.7\n", "utf8");
            await writeFile(join(buildDirectory, "workbench.synctex.gz"), "sync", "utf8");
            child.emit("close", 0, null);
          } else {
            stdout.write("main.tex:2: Undefined control sequence.\n");
            child.emit("close", 1, null);
          }
        });
      }
    });
    const request = { projectRoot: root, targetId: "target", profileId: "profile" };

    const first = await waitForBuild(service, request);
    expect(first.final.status).toBe("warning");
    expect(first.final.pdfPath).toBe(join(buildDirectory, "workbench.pdf"));
    expect(first.final.synctexPath).toBe(join(buildDirectory, "workbench.synctex.gz"));
    expect(first.events.some((event) => event.logChunk?.includes("Citation undefined"))).toBe(true);
    expect(invocations[0].command).toBe(tools.latexmk);
    expect(invocations[0].options.shell).toBe(false);
    expect(invocations[0].options.cwd).toBe(buildDirectory);
    expect(invocations[0].args).toContain("-norc");
    expect(invocations[0].args).not.toContain("-shell-escape");

    const second = await waitForBuild(service, request);
    expect(second.final).toEqual(expect.objectContaining({
      status: "failed",
      pdfPath: join(buildDirectory, "last-success.pdf"),
      synctexPath: join(buildDirectory, "last-success.synctex.gz"),
      stalePdf: true
    }));
  });
});
