import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, basename, join } from "node:path";

import type { FileReadResult } from "../../shared/types";
import { hashFile, hashesEqual, nonce, sha256 } from "./hashing";

export type SupportedTextEncoding = "utf8" | "utf8-bom";
export type LineEnding = "lf" | "crlf";

export class UnsupportedTextEncodingError extends Error {
  constructor(public readonly filePath: string, message = "文件不是有效的 UTF-8 文本") {
    super(`${message}: ${filePath}`);
    this.name = "UnsupportedTextEncodingError";
  }
}

export class ConcurrentFileChangeError extends Error {
  constructor(public readonly filePath: string) {
    super(`文件已被外部修改，请重新扫描后再试: ${filePath}`);
    this.name = "ConcurrentFileChangeError";
  }
}

export function detectLineEnding(content: string): LineEnding {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  const bareLf = (content.match(/(^|[^\r])\n/g) ?? []).length;
  return crlf > 0 && crlf >= bareLf ? "crlf" : "lf";
}

export function normalizeLineEndings(content: string, lineEnding: LineEnding): string {
  const lf = content.replace(/\r\n?/g, "\n");
  return lineEnding === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;
}

export function decodeUtf8(bytes: Uint8Array, filePath = "<memory>"): {
  content: string;
  encoding: SupportedTextEncoding;
  lineEnding: LineEnding;
} {
  const buffer = Buffer.from(bytes);
  if (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xff)
  ) {
    throw new UnsupportedTextEncodingError(filePath, "不支持 UTF-16；为避免损坏，文件将保持只读");
  }

  const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const content = decoder.decode(hasBom ? buffer.subarray(3) : buffer);
    if (content.includes("\0")) {
      throw new UnsupportedTextEncodingError(filePath, "文件包含 NUL 字符，可能不是文本文件");
    }
    return { content, encoding: hasBom ? "utf8-bom" : "utf8", lineEnding: detectLineEnding(content) };
  } catch (error) {
    if (error instanceof UnsupportedTextEncodingError) throw error;
    throw new UnsupportedTextEncodingError(filePath);
  }
}

export function encodeUtf8(content: string, encoding: SupportedTextEncoding): Buffer {
  const body = Buffer.from(content, "utf8");
  return encoding === "utf8-bom" ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

export async function readTextFile(filePath: string): Promise<FileReadResult> {
  const [bytes, handle] = await Promise.all([readFile(filePath), open(filePath, "r")]);
  try {
    const stat = await handle.stat();
    const decoded = decodeUtf8(bytes, filePath);
    return {
      path: filePath,
      content: decoded.content,
      hash: sha256(bytes),
      encoding: decoded.encoding,
      lineEnding: decoded.lineEnding,
      mtimeMs: stat.mtimeMs
    };
  } finally {
    await handle.close();
  }
}

export interface AtomicTextWriteOptions {
  encoding?: SupportedTextEncoding;
  lineEnding?: LineEnding;
  /** A hash requires that exact file; null requires that the destination does not exist. */
  expectedHash?: string | null;
  normalizeLineEndings?: boolean;
}

async function assertExpectedFileState(filePath: string, expectedHash: string | null): Promise<void> {
  let actualHash: string | null;
  try {
    actualHash = await hashFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    actualHash = null;
  }
  const matches = expectedHash === null ? actualHash === null : actualHash !== null && hashesEqual(expectedHash, actualHash);
  if (!matches) throw new ConcurrentFileChangeError(filePath);
}

export async function writeTextFileAtomic(
  filePath: string,
  content: string,
  options: AtomicTextWriteOptions = {}
): Promise<FileReadResult> {
  if (options.expectedHash !== undefined) {
    await assertExpectedFileState(filePath, options.expectedHash);
  }

  const lineEnding = options.lineEnding ?? detectLineEnding(content);
  const normalized = options.normalizeLineEndings ? normalizeLineEndings(content, lineEnding) : content;
  const bytes = encodeUtf8(normalized, options.encoding ?? "utf8");
  await writeFileAtomic(filePath, bytes, options.expectedHash);
  return readTextFile(filePath);
}

export async function writeFileAtomic(
  filePath: string,
  bytes: Uint8Array,
  expectedHash?: string | null
): Promise<void> {
  const parent = dirname(filePath);
  await mkdir(parent, { recursive: true });
  const temporaryPath = join(parent, `.${basename(filePath)}.${process.pid}.${nonce()}.tmp`);
  let temporaryExists = false;

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (expectedHash !== undefined) await assertExpectedFileState(filePath, expectedHash);
    await rename(temporaryPath, filePath);
    temporaryExists = false;
  } finally {
    if (temporaryExists) await rm(temporaryPath, { force: true });
  }
}

export const readPreservedTextFile = readTextFile;
export const atomicWriteTextFile = writeTextFileAtomic;
