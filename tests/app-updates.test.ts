import { createHash } from "node:crypto";
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
  });

  it("checks, downloads and verifies a private GitHub release asset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "latex-manager-updates-"));
    temporaryDirectories.push(directory);
    const assetName = "LaTeX-Project-Manager-Setup-0.3.1.exe";
    const bytes = Buffer.from("verified installer bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
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
            assets: [{ name: assetName, size: bytes.length, digest: `sha256:${digest}` }]
          }),
          stderr: ""
        };
      }
      if (args[0] === "release" && args[1] === "download") {
        const destinationDirectory = args[args.indexOf("--dir") + 1];
        await writeFile(join(destinationDirectory, assetName), bytes);
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected gh command: ${args.join(" ")}`);
    };
    const service = new AppUpdateService(directory, { currentVersion: "0.3.0", ghExecutable: "gh.exe", runner });

    const available = await service.check(false);
    expect(available.state).toBe("available");
    expect(available.latestVersion).toBe("0.3.1");

    const downloaded = await service.download();
    expect(downloaded.state).toBe("downloaded");
    expect(downloaded.downloadedPath).toContain(assetName);
    expect(await readFile(await service.downloadedInstaller())).toEqual(bytes);
    expect(commands.some((command) => command.includes("--clobber"))).toBe(true);
    await service.download();
    expect(commands.filter((command) => command[0] === "release" && command[1] === "download")).toHaveLength(1);

    const settings = await service.setSettings({ autoCheck: false, autoDownload: false });
    expect(settings).toMatchObject({ autoCheck: false, autoDownload: false });
  });
});
