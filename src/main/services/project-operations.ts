import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  type FileHandle
} from "node:fs/promises";
import { Transform } from "node:stream";
import { createDeflateRaw } from "node:zlib";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ProjectManifest, ProjectPdfInfo } from "../../shared/types";
import { createProjectId } from "./project-id";
import { hashFile } from "./files";
import { profileBuildDirectoryPath } from "./profile-runtime";
import { readProjectManifestIfExists, writeProjectManifest } from "./manifest";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".latex-workbench/build",
  ".latex-workbench/local-research-recovered",
  ".latex-workbench/runtime",
  ".latex-workbench/undo",
  ".latex-workbench/snapshots",
  ".latex-workbench/trash"
]);

const MAX_ZIP_VALUE = 0xffff_ffff;
const MAX_ZIP_ENTRIES = 0xffff;

export interface ProjectCopyResult {
  rootPath: string;
  manifest: ProjectManifest | null;
}

interface ProjectFileEntry {
  absolutePath: string;
  relativePath: string;
}

interface ZipEntryRecord {
  name: Buffer;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
}

interface PdfCandidate {
  path: string;
  priority: number;
  targetId?: string;
  profileId?: string;
}

const COMMON_PDF_OUTPUT_DIRECTORIES = ["output", "build", "out"] as const;
const EXCLUDED_PDF_SEARCH_DIRECTORIES = new Set([
  ".git",
  ".latex-workbench",
  "node_modules",
  "archive",
  "archives",
  "backup",
  "backups",
  "export",
  "exports",
  "figure",
  "figures",
  "downloads"
]);

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function foldedPath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function projectDirectoryName(value: string): string {
  const name = value.trim();
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (!name || name === "." || name === ".." || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || reserved.test(name)) {
    throw new Error("Project name is not a valid Windows directory name.");
  }
  return name;
}

function shouldExclude(relativePath: string, _name: string): boolean {
  const portable = portablePath(relativePath).toLocaleLowerCase("en-US");
  for (const excluded of EXCLUDED_DIRECTORIES) {
    if (portable === excluded || portable.startsWith(`${excluded}/`)) return true;
  }
  return false;
}

async function pathMustNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(`The destination already exists: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function copyTree(sourceRoot: string, destinationRoot: string, current = ""): Promise<void> {
  const sourceDirectory = join(sourceRoot, current);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    if (shouldExclude(relativePath, entry.name)) continue;
    const source = join(sourceRoot, relativePath);
    const destination = join(destinationRoot, relativePath);
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Project copy refuses symbolic links: ${source}`);
    }
    if (metadata.isDirectory()) {
      await mkdir(destination, { recursive: true });
      await copyTree(sourceRoot, destinationRoot, relativePath);
      continue;
    }
    if (!metadata.isFile()) throw new Error(`Project copy only supports regular files: ${source}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    const [sourceHash, destinationHash] = await Promise.all([hashFile(source), hashFile(destination)]);
    if (sourceHash !== destinationHash) {
      throw new Error(`The source changed while the project was being copied: ${source}`);
    }
  }
}

async function collectProjectFiles(root: string, current = "", output: ProjectFileEntry[] = []): Promise<ProjectFileEntry[]> {
  const directory = join(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    if (shouldExclude(relativePath, entry.name)) continue;
    const absolutePath = join(root, relativePath);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error(`ZIP export refuses symbolic links: ${absolutePath}`);
    if (metadata.isDirectory()) await collectProjectFiles(root, relativePath, output);
    else if (metadata.isFile()) output.push({ absolutePath, relativePath: portablePath(relativePath) });
    else throw new Error(`ZIP export only supports regular files: ${absolutePath}`);
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function zipNumber(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ZIP_VALUE) {
    throw new Error(`${label} exceeds the ZIP32 limit.`);
  }
  return value;
}

function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
  };
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<number> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten <= 0) throw new Error("The ZIP destination stopped accepting data.");
    offset += result.bytesWritten;
  }
  return offset;
}

async function writeZipArchive(files: ProjectFileEntry[], destination: string): Promise<void> {
  if (files.length > MAX_ZIP_ENTRIES) throw new Error("The project contains too many files for a ZIP32 archive.");
  const handle = await open(destination, "wx", 0o600);
  const records: ZipEntryRecord[] = [];
  let archiveOffset = 0;
  try {
    for (const file of files) {
      const metadata = await stat(file.absolutePath);
      const name = Buffer.from(file.relativePath, "utf8");
      if (name.byteLength > 0xffff) throw new Error(`ZIP entry path is too long: ${file.relativePath}`);
      const timestamp = dosTimestamp(metadata.mtime);
      const localHeaderOffset = zipNumber(archiveOffset, "ZIP local-header offset");
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0808, 6);
      localHeader.writeUInt16LE(8, 8);
      localHeader.writeUInt16LE(timestamp.time, 10);
      localHeader.writeUInt16LE(timestamp.date, 12);
      localHeader.writeUInt16LE(name.byteLength, 26);
      archiveOffset += await writeAll(handle, localHeader);
      archiveOffset += await writeAll(handle, name);

      let crc = 0xffff_ffff;
      let uncompressedSize = 0;
      let compressedSize = 0;
      const tracker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          crc = updateCrc32(crc, bytes);
          uncompressedSize += bytes.byteLength;
          callback(null, bytes);
        }
      });
      const compressed = createReadStream(file.absolutePath).pipe(tracker).pipe(createDeflateRaw());
      for await (const chunk of compressed) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        compressedSize += bytes.byteLength;
        archiveOffset += await writeAll(handle, bytes);
      }
      zipNumber(uncompressedSize, `Uncompressed size for ${file.relativePath}`);
      zipNumber(compressedSize, `Compressed size for ${file.relativePath}`);
      crc = (crc ^ 0xffff_ffff) >>> 0;

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(uncompressedSize, 12);
      archiveOffset += await writeAll(handle, descriptor);
      records.push({
        name,
        crc32: crc,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        dosTime: timestamp.time,
        dosDate: timestamp.date
      });
    }

    const centralDirectoryOffset = zipNumber(archiveOffset, "ZIP central-directory offset");
    for (const record of records) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(0x0314, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0808, 8);
      header.writeUInt16LE(8, 10);
      header.writeUInt16LE(record.dosTime, 12);
      header.writeUInt16LE(record.dosDate, 14);
      header.writeUInt32LE(record.crc32, 16);
      header.writeUInt32LE(record.compressedSize, 20);
      header.writeUInt32LE(record.uncompressedSize, 24);
      header.writeUInt16LE(record.name.byteLength, 28);
      header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      header.writeUInt32LE(record.localHeaderOffset, 42);
      archiveOffset += await writeAll(handle, header);
      archiveOffset += await writeAll(handle, record.name);
    }
    const centralDirectorySize = zipNumber(archiveOffset - centralDirectoryOffset, "ZIP central-directory size");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(records.length, 8);
    end.writeUInt16LE(records.length, 10);
    end.writeUInt32LE(centralDirectorySize, 12);
    end.writeUInt32LE(centralDirectoryOffset, 16);
    await writeAll(handle, end);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function lastSuccessFiles(root: string, current = "", output: string[] = []): Promise<string[]> {
  const directory = join(root, current);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    const path = join(root, relativePath);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`The build directory contains an unsafe symbolic link: ${path}`);
    if (metadata.isDirectory()) await lastSuccessFiles(root, relativePath, output);
    else if (metadata.isFile() && entry.name.toLocaleLowerCase("en-US") === "last-success.pdf") output.push(path);
  }
  return output;
}

async function pathWithoutSymlinks(root: string, candidate: string): Promise<boolean> {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  if (!isInside(absoluteRoot, absoluteCandidate)) throw new Error(`PDF candidate escapes the project root: ${candidate}`);
  const relation = relative(absoluteRoot, absoluteCandidate);
  let current = absoluteRoot;
  for (const segment of relation.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

async function matchingProjectPdfs(
  root: string,
  fileNames: Set<string>,
  current = "",
  depth = 0,
  output: string[] = []
): Promise<string[]> {
  if (depth > 12) return output;
  const directory = join(root, current);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    const path = join(root, relativePath);
    const metadata = await lstat(path);
    const lowerName = entry.name.toLocaleLowerCase("en-US");
    if (metadata.isSymbolicLink()) {
      if (fileNames.has(lowerName)) throw new Error(`PDF discovery refuses symbolic links: ${path}`);
      continue;
    }
    if (metadata.isDirectory()) {
      if (!EXCLUDED_PDF_SEARCH_DIRECTORIES.has(lowerName)) {
        await matchingProjectPdfs(root, fileNames, relativePath, depth + 1, output);
      }
    } else if (metadata.isFile() && fileNames.has(lowerName)) {
      output.push(path);
    }
  }
  return output;
}

function directoryDistance(left: string, right: string): number {
  return relative(left, right).split(/[\\/]+/).filter((segment) => segment && segment !== ".").length;
}

async function newestPdfCandidate(root: string, candidates: Iterable<PdfCandidate>): Promise<ProjectPdfInfo | null> {
  let newest: ProjectPdfInfo | null = null;
  let newestPriority = Number.NEGATIVE_INFINITY;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    try {
      if (!await pathWithoutSymlinks(root, candidate.path)) continue;
      const metadata = await stat(candidate.path);
      if (!metadata.isFile() || metadata.size === 0) continue;
      if (candidate.priority < newestPriority || (candidate.priority === newestPriority && metadata.mtimeMs <= newestTime)) continue;
      newestPriority = candidate.priority;
      newestTime = metadata.mtimeMs;
      newest = {
        path: candidate.path,
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        targetId: candidate.targetId,
        profileId: candidate.profileId
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return newest;
}

async function atomicCopy(source: string, destination: string): Promise<void> {
  const sourceMetadata = await lstat(source);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) throw new Error("The export source is not a regular file.");
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let temporaryExists = true;
  try {
    await copyFile(source, temporary);
    const [sourceHash, destinationHash] = await Promise.all([hashFile(source), hashFile(temporary)]);
    if (sourceHash !== destinationHash) throw new Error("The PDF changed while it was being exported.");
    await rename(temporary, destination);
    temporaryExists = false;
  } finally {
    if (temporaryExists) await rm(temporary, { force: true });
  }
}

async function safeExportDestination(
  projectRoot: string,
  destination: string,
  extension: ".zip" | ".pdf"
): Promise<string> {
  const root = await realpath(resolve(projectRoot));
  const requested = resolve(destination);
  const normalized = requested.toLocaleLowerCase("en-US").endsWith(extension)
    ? requested
    : `${requested}${extension}`;
  const parent = await realpath(dirname(normalized));
  const output = join(parent, basename(normalized));
  if (isInside(root, output)) {
    throw new Error(`Export destination must be outside the project directory: ${output}`);
  }
  try {
    const outputMetadata = await lstat(output);
    if (outputMetadata.isSymbolicLink() || !outputMetadata.isFile()) {
      throw new Error(`Export destination is not a regular file path: ${output}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return output;
}

export class ProjectOperationsService {
  async copy(sourceRoot: string, destinationParent: string, name: string): Promise<ProjectCopyResult> {
    const source = await realpath(resolve(sourceRoot));
    const sourceMetadata = await lstat(source);
    if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) throw new Error("The project source is not a regular directory.");
    const parent = await realpath(resolve(destinationParent));
    const parentMetadata = await lstat(parent);
    if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) throw new Error("The copy destination is not a regular directory.");
    if (isInside(source, parent)) throw new Error("A project copy cannot be created inside its source project.");

    const cleanName = projectDirectoryName(name);
    const destination = join(parent, cleanName);
    if (!isInside(parent, destination) || destination === parent) throw new Error("The project copy destination escapes its selected parent.");
    await pathMustNotExist(destination);

    const staging = join(parent, `.latex-workbench-copy-${randomBytes(8).toString("hex")}`);
    let stagingExists = false;
    try {
      await mkdir(staging, { recursive: false });
      stagingExists = true;
      await copyTree(source, staging);
      const copiedManifest = await readProjectManifestIfExists(staging);
      let manifest: ProjectManifest | null = null;
      if (copiedManifest) {
        const now = new Date().toISOString();
        manifest = await writeProjectManifest(staging, {
          ...copiedManifest,
          projectId: createProjectId(),
          name: cleanName,
          createdAt: now,
          updatedAt: now
        });
      }
      await rename(staging, destination);
      stagingExists = false;
      return { rootPath: await realpath(destination), manifest };
    } finally {
      if (stagingExists) await rm(staging, { recursive: true, force: true });
    }
  }

  async exportZip(projectRoot: string, destination: string): Promise<string> {
    const root = await realpath(resolve(projectRoot));
    const files = await collectProjectFiles(root);
    const output = await safeExportDestination(root, destination, ".zip");
    const temporary = join(dirname(output), `.${basename(output)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let temporaryExists = true;
    try {
      await writeZipArchive(files, temporary);
      await rename(temporary, output);
      temporaryExists = false;
    } finally {
      if (temporaryExists) await rm(temporary, { force: true });
    }
    return output;
  }

  async lastSuccessfulPdf(projectRoot: string, manifest?: ProjectManifest | null): Promise<ProjectPdfInfo | null> {
    const root = await realpath(resolve(projectRoot));
    const candidates = new Map<string, PdfCandidate>();
    const addCandidate = (candidate: PdfCandidate): void => {
      const key = foldedPath(candidate.path);
      const current = candidates.get(key);
      if (!current || candidate.priority > current.priority) candidates.set(key, candidate);
    };

    const externalTargets: Array<{
      targetId: string;
      entryDirectory: string;
      pdfFileName: string;
    }> = [];
    for (const target of manifest?.targets ?? []) {
      const entryPath = resolve(root, target.entry);
      if (!isInside(root, entryPath)) throw new Error(`Manifest entry escapes the project root: ${target.entry}`);
      if (!await pathWithoutSymlinks(root, entryPath)) continue;
      const entryMetadata = await lstat(entryPath);
      if (!entryMetadata.isFile()) continue;
      const entryDirectory = dirname(entryPath);
      const pdfFileName = `${basename(target.entry, extname(target.entry))}.pdf`;
      externalTargets.push({ targetId: target.id, entryDirectory, pdfFileName });
      addCandidate({
        path: join(entryDirectory, pdfFileName),
        priority: 400,
        targetId: target.id
      });
      for (const outputDirectory of new Set([
        ...COMMON_PDF_OUTPUT_DIRECTORIES.map((name) => join(entryDirectory, name)),
        ...COMMON_PDF_OUTPUT_DIRECTORIES.map((name) => join(root, name))
      ])) {
        addCandidate({
          path: join(outputDirectory, pdfFileName),
          priority: 400,
          targetId: target.id
        });
      }
    }

    const buildRoot = join(root, ".latex-workbench", "build");
    const identityByPath = new Map<string, { targetId: string; profileId: string }>();
    for (const target of manifest?.targets ?? []) {
      for (const profile of target.profiles) {
        const path = join(profileBuildDirectoryPath(root, target.id, profile.id), "last-success.pdf");
        const identity = { targetId: target.id, profileId: profile.id };
        identityByPath.set(foldedPath(path), identity);
        addCandidate({ path, priority: 300, ...identity });
      }
    }

    // The common case is deliberately O(targets × profiles): homepage status
    // checks should not walk every project tree merely to find main.pdf.
    const trusted = await newestPdfCandidate(root, candidates.values());
    if (trusted) return trusted;

    // Preserve compatibility with older/unregistered managed build folders,
    // but only after all known paths were checked and found empty.
    try {
      const buildMetadata = await lstat(buildRoot);
      if (!buildMetadata.isSymbolicLink() && buildMetadata.isDirectory()) {
        for (const path of await lastSuccessFiles(buildRoot)) {
          addCandidate({ path, priority: 300, ...identityByPath.get(foldedPath(path)) });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const managedFallback = await newestPdfCandidate(root, candidates.values());
    if (managedFallback) return managedFallback;

    // A bounded, low-confidence tree search is the last resort. It only
    // considers target basenames and ignores export/archive/figure folders.
    const targetNames = new Set(externalTargets.map((target) => target.pdfFileName.toLocaleLowerCase("en-US")));
    if (targetNames.size > 0) {
      for (const path of await matchingProjectPdfs(root, targetNames)) {
        const fileName = basename(path).toLocaleLowerCase("en-US");
        const matchingTargets = externalTargets
          .filter((target) => target.pdfFileName.toLocaleLowerCase("en-US") === fileName)
          .sort((left, right) => directoryDistance(left.entryDirectory, dirname(path)) - directoryDistance(right.entryDirectory, dirname(path)));
        const target = matchingTargets[0];
        if (target) {
          addCandidate({
            path,
            priority: Math.max(200, 250 - directoryDistance(target.entryDirectory, dirname(path))),
            targetId: target.targetId
          });
        }
      }
    }
    return newestPdfCandidate(root, candidates.values());
  }

  async exportPdf(projectRoot: string, source: string, destination: string): Promise<string> {
    const output = await safeExportDestination(projectRoot, destination, ".pdf");
    await atomicCopy(source, output);
    return output;
  }
}

export const copyProject = (sourceRoot: string, destinationParent: string, name: string): Promise<ProjectCopyResult> =>
  new ProjectOperationsService().copy(sourceRoot, destinationParent, name);
export const exportProjectZip = (projectRoot: string, destination: string): Promise<string> =>
  new ProjectOperationsService().exportZip(projectRoot, destination);
