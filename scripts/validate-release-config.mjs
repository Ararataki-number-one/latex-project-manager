import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const metadata = require(join(root, "package.json"));

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

const channel = metadata.config?.releaseChannel;
invariant(channel === "rc" || channel === "stable", "Desktop releaseChannel must be rc or stable");
if (channel === "rc") invariant(/^\d+\.\d+\.\d+-rc\.\d+$/.test(metadata.version), "Desktop RC version is invalid");
else invariant(/^\d+\.\d+\.\d+$/.test(metadata.version), "Desktop stable version is invalid");

if (channel === "rc") {
  const rcBuilder = require(join(root, "electron-builder.rc.cjs"));
  invariant(rcBuilder.appId === metadata.build.appId, "RC must use the formal appId");
  invariant(rcBuilder.productName === metadata.build.productName, "RC must use the formal product name");
  invariant(rcBuilder.extraMetadata?.name === metadata.name, "RC must use the formal package name");
  invariant(rcBuilder.extraMetadata?.version === metadata.version, "RC builder version must match package.json");
}

const workflowPaths = [
  ".github/workflows/release.yml",
  ".github/workflows/desktop-release.yml",
  ".github/workflows/android-viewer.yml"
];
const workflows = await Promise.all(workflowPaths.map(async (path) => ({
  path,
  text: await readFile(join(root, path), "utf8")
})));
for (const workflow of workflows) {
  const actionRefs = [...workflow.text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  invariant(actionRefs.length > 0, `${workflow.path} does not invoke any Actions`);
  for (const reference of actionRefs) {
    invariant(/^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/.test(reference), `${workflow.path} has a mutable Action ref: ${reference}`);
  }
}

const release = workflows.find((workflow) => workflow.path.endsWith("release.yml"))?.text ?? "";
invariant(release.includes("pnpm test:e2e"), "Release workflow must run Playwright");
invariant(release.includes("tests/electron-smoke.mjs"), "Release workflow must smoke-test packaged Electron");
for (const stepName of [
  "Smoke-test packaged Electron application",
  "Smoke-test Setup install, uninstall, and portable startup"
]) {
  const stepStart = release.indexOf(`- name: ${stepName}`);
  invariant(stepStart >= 0, `Release workflow is missing ${stepName}`);
  const step = release.slice(stepStart, stepStart + 520);
  invariant(
    step.includes("BUILD_CHANNEL: ${{ needs.validate.outputs.channel }}"),
    `${stepName} must receive the resolved release channel`
  );
}
invariant(release.includes("environment: production-release"), "Signing job must use the protected production-release environment");
invariant(release.includes("sign_manifest:"), "Manifest signing must be a separate job");
invariant(release.includes("if: needs.validate.outputs.channel == 'beta'"), "Android release must remain Beta-only");
invariant((release.match(/contents:\s*write/g) ?? []).length === 1, "Only the publishing job may request contents: write");
invariant(release.includes('run: rm -f "$RUNNER_TEMP/release-manifest-private.pem"'), "Manifest key cleanup is missing");
invariant(release.includes('rm -f "$RUNNER_TEMP/android-signing/latex-viewer.p12"'), "Android keystore cleanup is missing");

const rendererEntry = await readFile(join(root, "src/renderer/main.tsx"), "utf8");
const rendererCssImports = [...rendererEntry.matchAll(/import\s+["'](.+?\.css)["'];?/g)].map((match) => match[1]);
invariant(
  rendererCssImports.length === 1 && rendererCssImports[0] === "./styles.css",
  "Renderer must have exactly one CSS entry point: ./styles.css"
);
const rendererCssFiles = (await readdir(join(root, "src/renderer"))).filter((name) => name.endsWith(".css"));
invariant(
  rendererCssFiles.length === 1 && rendererCssFiles[0] === "styles.css",
  `Renderer contains multiple CSS layers: ${rendererCssFiles.join(", ")}`
);

process.stdout.write(`Release configuration verified for ${metadata.version} (${channel}).\n`);
