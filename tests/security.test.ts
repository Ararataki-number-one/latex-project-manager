import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectAccessController } from "../src/main/services/access-control";
import { isTrustedRendererUrl, rendererContentSecurityPolicy } from "../src/main/services/electron-security";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("renderer security policy", () => {
  it("allows only the exact production document and rejects file-origin navigation", () => {
    const expected = "file:///C:/app/renderer/index.html";
    expect(isTrustedRendererUrl(expected, expected)).toBe(true);
    expect(isTrustedRendererUrl("file:///C:/Users/Public/secret.html", expected)).toBe(false);
    expect(isTrustedRendererUrl("https://127.0.0.1:5173/other", "https://127.0.0.1:5173/" )).toBe(false);
  });

  it("emits a CSP that denies frames and object/plugin execution", () => {
    const policy = rendererContentSecurityPolicy(false);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("worker-src 'self' blob:");
  });
});

describe("project access registry", () => {
  it("requires a native selection before accepting a scan candidate", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-access-")));
    temporaryDirectories.push(root);
    const project = join(root, "project");
    const unrelated = join(root, "unrelated");
    await mkdir(project);
    await mkdir(unrelated);
    const access = new ProjectAccessController();
    await access.addSelection(root);
    const canonical = await access.registerPendingCandidate(project);
    expect(await access.consumePendingCandidate(canonical)).toBe(canonical);
    await expect(access.requireProjectRoot(unrelated)).rejects.toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });
  });

  it("does not treat a catalog path that has been replaced as the same project", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "latex-workbench-access-")));
    temporaryDirectories.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const access = new ProjectAccessController([project]);
    await writeFile(join(project, "main.tex"), "x", "utf8");
    expect(await access.requireProjectRoot(project)).toBe(project);
  });
});
