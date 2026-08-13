import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("release configuration", () => {
  it("passes the static RC release gate", () => {
    expect(() => execFileSync(process.execPath, ["scripts/validate-release-config.mjs"], {
      cwd: root,
      stdio: "pipe"
    })).not.toThrow();
  });

  it("signs an rc.N manifest and rejects unknown prerelease labels", () => {
    const directory = mkdtempSync(join(tmpdir(), "latex-release-config-"));
    try {
      const { privateKey } = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
      });
      const key = join(directory, "release.pem");
      const asset = join(directory, "client.exe");
      const output = join(directory, "release-manifest.json");
      writeFileSync(key, privateKey, "utf8");
      writeFileSync(asset, "verified rc asset", "utf8");
      execFileSync(process.execPath, [
        "scripts/sign-release-manifest.mjs",
        "--version", "1.0.0-rc.7",
        "--tag", "v1.0.0-rc.7",
        "--private-key", key,
        "--output", output,
        "--asset", `windows-setup=${asset}`
      ], { cwd: root, stdio: "pipe" });
      const manifest = JSON.parse(readFileSync(output, "utf8")) as { signed: { version: string; tag: string } };
      expect(manifest.signed).toMatchObject({ version: "1.0.0-rc.7", tag: "v1.0.0-rc.7" });
      expect(() => execFileSync(process.execPath, [
        "scripts/sign-release-manifest.mjs",
        "--version", "1.0.0-preview.1",
        "--tag", "v1.0.0-preview.1",
        "--private-key", key,
        "--output", join(directory, "invalid.json"),
        "--asset", `windows-setup=${asset}`
      ], { cwd: root, stdio: "pipe" })).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
