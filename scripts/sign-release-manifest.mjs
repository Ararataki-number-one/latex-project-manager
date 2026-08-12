import { createHash, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

function argument(name, multiple = false) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return multiple ? values : values.at(-1);
}

async function sha256(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

const version = argument("--version");
const tag = argument("--tag") ?? (version ? `v${version}` : undefined);
const privateKeyPath = argument("--private-key");
const output = resolve(argument("--output") ?? "dist/release-manifest.json");
const assetArguments = argument("--asset", true);
if (!version || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version) || tag !== `v${version}` || !privateKeyPath || !assetArguments.length) {
  throw new Error("Usage: --version X.Y.Z[-beta.N] --tag vX.Y.Z[-beta.N] --private-key path --output path --asset kind=path");
}

const allowedKinds = new Set(["windows-setup", "windows-portable", "android-apk"]);
const assets = [];
for (const value of assetArguments) {
  const separator = value.indexOf("=");
  const kind = value.slice(0, separator);
  const path = resolve(value.slice(separator + 1));
  if (separator < 1 || !allowedKinds.has(kind)) throw new Error(`Unsupported release asset: ${value}`);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Release asset is not a file: ${path}`);
  const certificateSha256 = kind.startsWith("windows")
    ? process.env.WINDOWS_CERTIFICATE_SHA256
    : process.env.ANDROID_CERTIFICATE_SHA256;
  assets.push({
    kind,
    name: basename(path),
    size: metadata.size,
    sha256: await sha256(path),
    ...(certificateSha256 ? { certificateSha256: certificateSha256.replace(/[^a-f0-9]/gi, "").toLowerCase() } : {})
  });
}
assets.sort((left, right) => left.kind.localeCompare(right.kind));

const signed = {
  schemaVersion: 1,
  keyId: "latex-project-manager-release-ed25519-v1",
  version,
  tag,
  generatedAt: new Date().toISOString(),
  assets
};
const privateKey = await readFile(resolve(privateKeyPath), "utf8");
const payloadBytes = Buffer.from(JSON.stringify(signed), "utf8");
const payload = payloadBytes.toString("base64");
const signature = sign(null, payloadBytes, privateKey).toString("base64");
const manifest = {
  signed,
  payload,
  signature: {
    algorithm: "Ed25519",
    keyId: signed.keyId,
    value: signature
  }
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
await writeFile(
  resolve(dirname(output), "release-checksums.sha256"),
  `${assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n")}\n`,
  { encoding: "utf8", mode: 0o644 }
);
