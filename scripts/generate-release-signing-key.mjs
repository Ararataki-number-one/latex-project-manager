import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privatePath = resolve(root, ".signing", "release-manifest-ed25519-private.pem");
const publicPath = resolve(root, "release-manifest-public.pem");
const modulePath = resolve(root, "src", "shared", "release-public-key.ts");

if (existsSync(privatePath)) {
  throw new Error(`Refusing to replace the existing release signing key: ${privatePath}`);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

await mkdir(dirname(privatePath), { recursive: true });
await writeFile(privatePath, privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
await writeFile(publicPath, publicKey, { encoding: "utf8", mode: 0o644, flag: "wx" });
await writeFile(
  modulePath,
  `// Generated public verification key. The matching private key is never committed.\nexport const RELEASE_MANIFEST_PUBLIC_KEY_PEM = ${JSON.stringify(publicKey)};\n`,
  { encoding: "utf8", mode: 0o644, flag: "wx" }
);

process.stdout.write(`Release manifest public key created at ${publicPath}\n`);
