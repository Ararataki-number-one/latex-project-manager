import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanPublicResearchCopyright, scanSyncSecurity, scanSyncSecuritySnapshot } from "../src/main/services/sync-security";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("sync security preflight", () => {
  it("blocks high-confidence secrets and warns for sensitive names", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-sync-security-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "notes.tex"), "token=github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890_secret\n", "utf8");
    await writeFile(join(root, ".env"), "PUBLIC_NAME=notes\n", "utf8");

    const findings = await scanSyncSecurity(root, [
      { path: "notes.tex", status: "??" },
      { path: ".env", status: "??" }
    ], []);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "notes.tex", kind: "secret", severity: "block" }),
      expect.objectContaining({ path: ".env", kind: "sensitiveFile", severity: "warning" })
    ]));
  });

  it("warns for ordinary large files, blocks GitHub-limit files and ignores deletions", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-sync-large-"));
    temporaryDirectories.push(root);
    const findings = await scanSyncSecurity(root, [
      { path: "paper.pdf", status: "??" },
      { path: "huge.pdf", status: "??" },
      { path: "deleted.env", status: "D" }
    ], [
      { path: "paper.pdf", size: 25 * 1024 * 1024, trackedByLfs: false },
      { path: "huge.pdf", size: 101 * 1024 * 1024, trackedByLfs: false }
    ]);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "paper.pdf", severity: "warning" }),
      expect.objectContaining({ path: "huge.pdf", severity: "block" })
    ]));
    expect(findings.some((finding) => finding.path === "deleted.env")).toBe(false);
  });

  it("scans the immutable candidate blob supplied by Git rather than a later worktree value", async () => {
    const findings = await scanSyncSecuritySnapshot(
      [{ path: "main.tex", status: "M " }],
      [],
      async () => Buffer.from("token=github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890_secret\n", "utf8")
    );
    expect(findings).toContainEqual(expect.objectContaining({ path: "main.tex", kind: "secret", severity: "block" }));
  });

  it("blocks local-only research metadata that leaks a path into the Git candidate", async () => {
    const bytes = Buffer.from(JSON.stringify({
      schemaVersion: 3,
      researchItems: [{ attachments: [{ id: "private", availability: "localOnly", relativePath: "references/private.pdf" }] }]
    }), "utf8");
    const findings = await scanSyncSecuritySnapshot(
      [{ path: ".latex-project.json", status: "M " }], [], async () => bytes
    );
    expect(findings).toContainEqual(expect.objectContaining({
      path: ".latex-project.json", kind: "sensitiveFile", severity: "block"
    }));
  });

  it("blocks repository research without explicit publication approval in a public candidate tree", () => {
    const index = Buffer.from(JSON.stringify({
      schemaVersion: 3,
      researchItems: [{ attachments: [
        { id: "blocked", name: "publisher.pdf", availability: "repository", relativePath: "references/publisher.pdf" },
        { id: "approved", name: "open.pdf", availability: "repository", relativePath: "references/open.pdf", publicUploadApproved: true }
      ] }]
    }), "utf8");
    const findings = scanPublicResearchCopyright(index, [".latex-project.json", "references/publisher.pdf", "references/open.pdf"]);
    expect(findings).toEqual([expect.objectContaining({
      path: "references/publisher.pdf",
      kind: "researchCopyright",
      severity: "block",
      recoveryActions: ["keepResearchLocalOnly", "approveResearchUpload"]
    })]);
  });

  it("blocks an unregistered references document before public auto-sync can race its metadata", () => {
    const findings = scanPublicResearchCopyright(null, ["main.tex", "references/new-source.pdf"]);
    expect(findings).toEqual([expect.objectContaining({
      path: "references/new-source.pdf",
      kind: "researchCopyright",
      severity: "block"
    })]);
  });
});
