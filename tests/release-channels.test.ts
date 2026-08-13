import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packageMetadata = require(join(root, "package.json")) as {
  version: string;
  config: { betaVersion: string; releaseChannel: string };
  build: { appId: string; productName: string };
};
const rcBuilder = require(join(root, "electron-builder.rc.cjs")) as {
  appId: string;
  productName: string;
  directories: { output: string };
  extraMetadata: { name: string; version: string; releaseChannel: string };
  publish: { releaseType: string };
};
const betaBuilder = require(join(root, "electron-builder.beta.cjs")) as {
  appId: string;
  productName: string;
  directories: { output: string };
  extraMetadata: { name: string; version: string; releaseChannel: string };
  publish: { releaseType: string };
};

describe("parallel release channels", () => {
  it("gives the RC the formal desktop identity while keeping Beta separate", () => {
    const mainProcess = readFileSync(join(root, "src/main/index.ts"), "utf8");
    expect(packageMetadata.version).toMatch(/^1\.0\.0-rc\.\d+$/);
    expect(packageMetadata.config.releaseChannel).toBe("rc");
    expect(packageMetadata.config.betaVersion).toMatch(/^1\.0\.0-beta\.\d+$/);
    expect(rcBuilder.appId).toBe(packageMetadata.build.appId);
    expect(rcBuilder.productName).toBe(packageMetadata.build.productName);
    expect(rcBuilder.directories.output).toBe("dist-rc");
    expect(rcBuilder.extraMetadata).toEqual({
      name: "latex-workbench",
      version: packageMetadata.version,
      releaseChannel: "rc"
    });
    expect(rcBuilder.publish.releaseType).toBe("prerelease");
    expect(betaBuilder.appId).toBe("local.latex.workbench.beta");
    expect(betaBuilder.appId).not.toBe(packageMetadata.build.appId);
    expect(betaBuilder.productName).not.toBe(packageMetadata.build.productName);
    expect(betaBuilder.directories.output).toBe("dist-beta");
    expect(betaBuilder.extraMetadata).toMatchObject({
      name: "latex-workbench-beta",
      version: packageMetadata.config.betaVersion,
      releaseChannel: "beta"
    });
    expect(betaBuilder.publish.releaseType).toBe("prerelease");
    expect(mainProcess).toContain('"local.latex.workbench.beta" : "local.latex.workbench"');
    expect(mainProcess).toContain('join(app.getPath("appData"), "latex-workbench-beta")');
  });

  it("keeps Android on its independent Beta line during the desktop RC", () => {
    const gradle = readFileSync(join(root, "android-viewer/app/build.gradle.kts"), "utf8");
    const betaLabel = readFileSync(join(root, "android-viewer/app/src/beta/res/values/strings.xml"), "utf8");
    expect(gradle).toContain('create("stable")');
    expect(gradle).toContain('versionName = "0.11.1"');
    expect(gradle).toContain('create("beta")');
    expect(gradle).toContain('applicationIdSuffix = ".beta"');
    expect(gradle).toContain(`versionName = "${packageMetadata.config.betaVersion}"`);
    expect(betaLabel).toContain("LaTeX 项目 Beta");
  });

  it("publishes the RC as desktop-only and keeps signing isolated", () => {
    const release = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
    const signer = readFileSync(join(root, "scripts/sign-release-manifest.mjs"), "utf8");
    expect(release).toContain("*-beta.*");
    expect(release).toContain("*-rc.*");
    expect(release).toContain("if: needs.validate.outputs.channel == 'beta'");
    expect(release).toContain("prerelease: ${{ needs.validate.outputs.channel == 'rc' }}");
    expect(release).toContain("environment: production-release");
    expect(release).toContain("sign_manifest:");
    expect(release).toContain("release-windows-${{ needs.validate.outputs.channel }}");
    expect(release).toContain("release-android-${{ needs.validate.outputs.channel }}");
    expect(release).toContain("LaTeX.Android.$LABEL.$RELEASE_VERSION.apk");
    expect(signer).toContain("(?:-(?:beta|rc)\\.\\d+)?");
    expect(signer).toContain("tag !== `v${version}`");
  });
});
