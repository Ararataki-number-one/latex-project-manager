import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppUpdateService, compareVersions, type UpdateCommandRunner } from "../src/main/services/app-updates";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("application updates", () => {
  it("compares stable semantic versions", () => {
    expect(compareVersions("0.3.1", "0.3.0")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.9", "1.0.0")).toBe(-1);
  });

  it("selects the newest beta prerelease without changing the stable channel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "latex-manager-beta-updates-"));
    temporaryDirectories.push(directory);
    const commands: string[][] = [];
    const runner: UpdateCommandRunner = async (_executable, _cwd, args) => {
      commands.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "gh version 2.76.0\n", stderr: "" };
      if (args[0] === "release" && args[1] === "list") {
        return {
          code: 0,
          stdout: JSON.stringify([
            { tagName: "v1.0.0-beta.1", isDraft: false, isPrerelease: true },
            { tagName: "v0.11.1", isDraft: false, isPrerelease: false },
            { tagName: "v1.0.0-beta.3", isDraft: false, isPrerelease: true }
          ]),
          stderr: ""
        };
      }
      if (args[0] === "release" && args[1] === "view") {
        return {
          code: 0,
          stdout: JSON.stringify({
            tagName: "v1.0.0-beta.3",
            name: "Beta 3",
            url: "https://example.invalid/beta-3",
            isDraft: false,
            isPrerelease: true,
            assets: []
          }),
          stderr: ""
        };
      }
      throw new Error(`Unexpected gh command: ${args.join(" ")}`);
    };
    const service = new AppUpdateService(directory, {
      currentVersion: "1.0.0-beta.1",
      releaseChannel: "beta",
      ghExecutable: "gh.exe",
      runner
    });

    await service.check(false);

    expect(commands.some((args) => args[0] === "release" && args[1] === "list")).toBe(true);
    expect(commands.find((args) => args[0] === "release" && args[1] === "view")?.[2]).toBe("v1.0.0-beta.3");
  });

  it("checks, downloads and verifies a private GitHub release asset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "latex-manager-updates-"));
    temporaryDirectories.push(directory);
    const assetName = "LaTeX-Project-Manager-Setup-0.3.1.exe";
    const bytes = Buffer.from("verified installer bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    const signed = {
      schemaVersion: 1 as const,
      keyId: "latex-project-manager-release-ed25519-v1",
      version: "0.3.1",
      tag: "v0.3.1",
      generatedAt: "2026-08-11T02:00:00Z",
      assets: [{ kind: "windows-setup", name: assetName, size: bytes.length, sha256: digest }]
    };
    const payloadBytes = Buffer.from(JSON.stringify(signed), "utf8");
    const manifestBytes = Buffer.from(`${JSON.stringify({
      signed,
      payload: payloadBytes.toString("base64"),
      signature: {
        algorithm: "Ed25519",
        keyId: signed.keyId,
        value: sign(null, payloadBytes, privateKey).toString("base64")
      }
    }, null, 2)}\n`);
    const commands: string[][] = [];
    const runner: UpdateCommandRunner = async (_executable, _cwd, args) => {
      commands.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "gh version 2.76.0 (2026-01-01)\n", stderr: "" };
      if (args[0] === "release" && args[1] === "view") {
        return {
          code: 0,
          stdout: JSON.stringify({
            tagName: "v0.3.1",
            name: "LaTeX 项目管理器 v0.3.1",
            url: "https://github.com/Ararataki-number-one/latex-project-manager/releases/tag/v0.3.1",
            publishedAt: "2026-08-11T02:00:00Z",
            isDraft: false,
            isPrerelease: false,
            assets: [
              { name: assetName, size: bytes.length, digest: `sha256:${digest}` },
              { name: "release-manifest.json", size: manifestBytes.length }
            ]
          }),
          stderr: ""
        };
      }
      if (args[0] === "release" && args[1] === "download") {
        const destinationDirectory = args[args.indexOf("--dir") + 1];
        const pattern = args[args.indexOf("--pattern") + 1];
        await writeFile(
          join(destinationDirectory, pattern),
          pattern === "release-manifest.json" ? manifestBytes : bytes
        );
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected gh command: ${args.join(" ")}`);
    };
    const service = new AppUpdateService(directory, {
      currentVersion: "0.3.0",
      ghExecutable: "gh.exe",
      runner,
      publicKeyPem: publicKey
    });

    const available = await service.check(false);
    expect(available.state).toBe("available");
    expect(available.latestVersion).toBe("0.3.1");

    const downloaded = await service.download();
    expect(downloaded.state).toBe("downloaded");
    expect(downloaded.downloadedPath).toContain(assetName);
    expect(await readFile(await service.downloadedInstaller())).toEqual(bytes);
    expect(commands.some((command) => command.includes("--clobber"))).toBe(true);
    await service.download();
    expect(commands.filter((command) => command[0] === "release" && command[1] === "download" && command.includes(assetName))).toHaveLength(1);

    const settings = await service.setSettings({ autoCheck: false, autoDownload: false });
    expect(settings).toMatchObject({ autoCheck: false, autoDownload: false });

    await rm(downloaded.downloadedPath!, { force: true });
    let started!: () => void;
    const downloadStarted = new Promise<void>((resolve) => { started = resolve; });
    const interrupted = new AppUpdateService(directory, {
      currentVersion: "0.3.0",
      ghExecutable: "gh.exe",
      runner,
      publicKeyPem: publicKey,
      downloader: async (_url, destination, options) => {
        const partial = bytes.subarray(0, 8);
        await writeFile(destination, partial);
        options.onProgress({ downloadedBytes: partial.length, totalBytes: bytes.length });
        started();
        await new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
        });
      }
    });
    await interrupted.check(false);
    const interruptedJob = interrupted.download();
    await downloadStarted;
    const cancelled = await interrupted.cancel();
    expect(cancelled).toMatchObject({ state: "cancelled", downloadedBytes: 8, totalBytes: bytes.length, canRetry: true });
    await interruptedJob;

    let resumedFrom = -1;
    const resumed = new AppUpdateService(directory, {
      currentVersion: "0.3.0",
      ghExecutable: "gh.exe",
      runner,
      publicKeyPem: publicKey,
      downloader: async (_url, destination, options) => {
        resumedFrom = options.resumeFrom;
        await writeFile(destination, bytes.subarray(options.resumeFrom), { flag: "a" });
        options.onProgress({ downloadedBytes: bytes.length, totalBytes: bytes.length });
      }
    });
    const resumedStatus = await resumed.download();
    expect(resumedFrom).toBe(8);
    expect(resumedStatus).toMatchObject({ state: "downloaded", downloadedBytes: bytes.length, totalBytes: bytes.length, progressPercent: 100 });
  });
});
