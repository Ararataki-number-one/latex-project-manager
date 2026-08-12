import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GitHubSyncService,
  decideSafeRemoteAction,
  normalizeGitHubRemoteUrl,
  type GitCommandResult,
  type GitCommandRunner
} from "../src/main/services/github-sync";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("GitHub synchronization", () => {
  it("only permits an automatic fast-forward for a clean, non-diverged branch", () => {
    expect(decideSafeRemoteAction(0, 0, 0)).toBe("none");
    expect(decideSafeRemoteAction(2, 0, 1)).toBe("none");
    expect(decideSafeRemoteAction(0, 1, 0)).toBe("fastForward");
    expect(decideSafeRemoteAction(0, 1, 1)).toBe("blocked");
    expect(decideSafeRemoteAction(1, 1, 0)).toBe("blocked");
  });

  it("accepts only credential-free github.com repository URLs", () => {
    expect(normalizeGitHubRemoteUrl("https://github.com/example/notes")).toBe("https://github.com/example/notes.git");
    expect(normalizeGitHubRemoteUrl("git@github.com:example/notes.git")).toBe("git@github.com:example/notes.git");
    expect(normalizeGitHubRemoteUrl("ssh://git@github.com/example/notes")).toBe("ssh://git@github.com/example/notes.git");

    expect(() => normalizeGitHubRemoteUrl("https://token@github.com/example/notes.git")).toThrow(/不能包含|credentials/i);
    expect(() => normalizeGitHubRemoteUrl("https://gitlab.com/example/notes.git")).toThrow(/github\.com/i);
    expect(() => normalizeGitHubRemoteUrl("https://github.com/example/notes/extra")).toThrow(/owner\/repository/i);
  });

  it("stages additions and deletions together and never force-pushes", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-workbench-github-"));
    temporaryDirectories.push(base);
    const root = join(base, "project");
    const configDirectory = join(base, "config");
    await (await import("node:fs/promises")).mkdir(root);
    await writeFile(join(root, "main.tex"), "\\documentclass{article}\n", "utf8");

    let repository = false;
    let remote = false;
    let staged = false;
    let committed = false;
    let identityName = "";
    let identityEmail = "";
    const blobId = "1".repeat(40);
    const treeId = "2".repeat(40);
    const commitId = "3".repeat(40);
    const commands: string[][] = [];
    const result = (code = 0, stdout = "", stderr = ""): GitCommandResult => ({ code, stdout, stderr });
    const runner: GitCommandRunner = async (_executable, cwd, args) => {
      expect(cwd).toBe(root);
      expect(args[0]).toBe("-c");
      expect(args[1]).toMatch(/^core\.hooksPath=.*\/git-hooks\/[a-f0-9]{64}$/);
      expect(args[1]).not.toContain("NUL");
      const command = args.slice(2);
      commands.push(command);
      if (command[0] === "--version") return result(0, "git version 2.50.0.windows.1\n");
      if (command[0] === "rev-parse" && command[1] === "--show-toplevel") return repository ? result(0, `${root}\n`) : result(128, "", "not a repository");
      if (command[0] === "rev-parse" && command[1] === "--verify" && command[2] === "HEAD") return committed ? result(0, `${commitId}\n`) : result(128);
      if (command[0] === "init") { repository = true; return result(); }
      if (command[0] === "symbolic-ref" && command[1] === "--short") return result(0, "main\n");
      if (command[0] === "remote" && command[1] === "get-url") return remote ? result(0, "https://github.com/example/notes.git\n") : result(2);
      if (command[0] === "remote" && (command[1] === "add" || command[1] === "set-url")) { remote = true; return result(); }
      if (command[0] === "lfs" && command[1] === "version") return result(0, "git-lfs/3.7.0\n");
      if (command[0] === "lfs" && command[1] === "install") return result();
      if (command[0] === "lfs" && command[1] === "track") return result();
      if (command[0] === "status") return committed ? result() : result(0, "D  removed.tex\0?? main.tex\0");
      if (command[0] === "log") return committed ? result(0, `abc123\0自动同步\0${"2026-08-10T12:00:00+08:00"}\n`) : result(128);
      if (command[0] === "show-ref") return result(1);
      if (command[0] === "add") { staged = true; return result(); }
      if (command[0] === "write-tree") return result(0, `${treeId}\n`);
      if (command[0] === "ls-files" && command[1] === "--stage") return result(0, `100644 ${blobId} 0\tmain.tex\0`);
      if (command[0] === "cat-file" && command[1] === "-s") return result(0, "24\n");
      if (command[0] === "cat-file" && command[1] === "blob") return result(0, "\\documentclass{article}\n");
      if (command[0] === "diff" && command.includes("--cached")) return result(staged ? 1 : 0);
      if (command[0] === "config" && command[1] === "--local" && command[2] === "user.name") { identityName = command[3]; return result(); }
      if (command[0] === "config" && command[1] === "--local" && command[2] === "user.email") { identityEmail = command[3]; return result(); }
      if (command[0] === "config" && command[1] === "--local" && command[2] === "--get" && command[3] === "user.name") return identityName ? result(0, `${identityName}\n`) : result(1);
      if (command[0] === "config" && command[1] === "--local" && command[2] === "--get" && command[3] === "user.email") return identityEmail ? result(0, `${identityEmail}\n`) : result(1);
      if (command[0] === "config" && command[1] === "--get" && command[2] === "user.name") return identityName ? result(0, `${identityName}\n`) : result(1);
      if (command[0] === "config" && command[1] === "--get" && command[2] === "user.email") return identityEmail ? result(0, `${identityEmail}\n`) : result(1);
      if (command[0] === "commit-tree") return result(0, `${commitId}\n`);
      if (command[0] === "update-ref") { committed = true; staged = false; return result(); }
      if (command[0] === "ls-remote") return result(2);
      if (command[0] === "push") return result();
      throw new Error(`Unexpected Git command: ${command.join(" ")}`);
    };

    const service = new GitHubSyncService(configDirectory, {
      platform: "win32",
      gitExecutable: "git.exe",
      runner,
      watcherFactory: () => ({ close: () => undefined })
    });
    await service.configure("project-1", root, {
      remoteUrl: "https://github.com/example/notes",
      autoSync: false,
      useLfsForDocuments: true
    });
    const identified = await service.setIdentity("project-1", root, { name: "Reader", email: "reader@example.test" });
    const synced = await service.syncNow("project-1", root);

    expect(identified.identity).toEqual({ name: "Reader", email: "reader@example.test", configured: true, source: "local" });
    expect(synced.state).toBe("synced");
    expect(commands).toContainEqual(["add", "-A", "--", "."]);
    expect(commands.some((command) => command[0] === "commit-tree" && command.includes(treeId))).toBe(true);
    expect(commands).toContainEqual(["update-ref", "refs/heads/main", commitId]);
    expect(commands).toContainEqual(["push", "-u", "origin", "main"]);
    expect(commands).toContainEqual(["lfs", "install", "--local", "--force"]);
    expect(commands).toContainEqual(["lfs", "track", "*.pdf", "*.epub", "*.djvu"]);
    expect(commands.filter((command) => command[0] === "push").flat()).not.toContain("--force");
    expect(await readdir(join(configDirectory, "git-hooks"))).toHaveLength(1);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".latex-workbench/build/");
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".latex-workbench/undo/");
    expect(await readFile(join(root, ".gitignore"), "utf8")).not.toContain("references/");
    await service.dispose();
  });

  it("blocks an undo snapshot that was already tracked without reading or committing it", async () => {
    const base = await mkdtemp(join(tmpdir(), "latex-workbench-github-undo-"));
    temporaryDirectories.push(base);
    const root = join(base, "project");
    const configDirectory = join(base, "config");
    await (await import("node:fs/promises")).mkdir(root);
    const blobId = "4".repeat(40);
    const treeId = "5".repeat(40);
    const commands: string[][] = [];
    const result = (code = 0, stdout = "", stderr = ""): GitCommandResult => ({ code, stdout, stderr });
    const runner: GitCommandRunner = async (_executable, cwd, args) => {
      expect(cwd).toBe(root);
      const command = args.slice(2);
      commands.push(command);
      if (command[0] === "rev-parse" && command[1] === "--show-toplevel") return result(0, `${root}\n`);
      if (command[0] === "add") return result();
      if (command[0] === "write-tree") return result(0, `${treeId}\n`);
      if (command[0] === "ls-files" && command[1] === "--stage") {
        return result(0, `100644 ${blobId} 0\t.latex-workbench/undo/private/journal.json\0`);
      }
      if (command[0] === "status") return result(0, "M  .latex-workbench/undo/private/journal.json\0");
      throw new Error(`Unexpected Git command: ${command.join(" ")}`);
    };
    const service = new GitHubSyncService(configDirectory, {
      platform: "win32",
      gitExecutable: "git.exe",
      runner,
      watcherFactory: () => ({ close: () => undefined })
    });

    const findings = await service.securityPreflight("project-undo", root);
    expect(findings).toContainEqual(expect.objectContaining({
      path: ".latex-workbench/undo/private/journal.json",
      kind: "sensitiveFile",
      severity: "block"
    }));
    expect(commands.some((command) => command[0] === "cat-file")).toBe(false);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".latex-workbench/undo/");
    await service.dispose();
  });
});
