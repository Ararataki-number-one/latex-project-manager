import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packageMetadata = require(join(root, "package.json")) as {
  version: string;
  config: { betaVersion: string };
  build: { appId: string; productName: string };
};
const betaBuilder = require(join(root, "electron-builder.beta.cjs")) as {
  appId: string;
  productName: string;
  directories: { output: string };
  extraMetadata: { name: string; version: string; releaseChannel: string };
  publish: { releaseType: string };
};

describe("parallel release channels", () => {
  it("keeps stable 0.11.1 metadata separate from 1.0 beta", () => {
    const mainProcess = readFileSync(join(root, "src/main/index.ts"), "utf8");
    expect(packageMetadata.version).toBe("0.11.1");
    expect(packageMetadata.config.betaVersion).toBe("1.0.0-beta.3");
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

  it("gives Android stable and beta variants independent identities", () => {
    const gradle = readFileSync(join(root, "android-viewer/app/build.gradle.kts"), "utf8");
    const betaLabel = readFileSync(join(root, "android-viewer/app/src/beta/res/values/strings.xml"), "utf8");
    expect(gradle).toContain('create("stable")');
    expect(gradle).toContain('versionName = "0.11.1"');
    expect(gradle).toContain('create("beta")');
    expect(gradle).toContain('applicationIdSuffix = ".beta"');
    expect(gradle).toContain('versionName = "1.0.0-beta.3"');
    expect(betaLabel).toContain("LaTeX 项目 Beta");
  });

  it("publishes beta tags as prereleases with channel-specific assets", () => {
    const release = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
    const signer = readFileSync(join(root, "scripts/sign-release-manifest.mjs"), "utf8");
    expect(release).toContain("*-beta.*");
    expect(release).toContain("prerelease: ${{ needs.validate.outputs.channel == 'beta' }}");
    expect(release).toContain("release-windows-${{ needs.validate.outputs.channel }}");
    expect(release).toContain("release-android-${{ needs.validate.outputs.channel }}");
    expect(release).toContain("LaTeX.Android.$LABEL.$RELEASE_VERSION.apk");
    expect(signer).toContain("(?:-beta\\.\\d+)?");
    expect(signer).toContain("tag !== `v${version}`");
  });
});
