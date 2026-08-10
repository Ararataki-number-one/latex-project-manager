import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);

  try {
    let bytesRead = 0;
    do {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.length, null));
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    await handle.close();
  }

  return hash.digest("hex");
}

export function hashesEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.toLowerCase(), "hex"), Buffer.from(right.toLowerCase(), "hex"));
}

export function stableId(namespace: string, value: string): string {
  const prefix = namespace
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "id";
  return `${prefix}-${sha256(value).slice(0, 16)}`;
}

export function nonce(bytes = 8): string {
  return randomBytes(bytes).toString("hex");
}
