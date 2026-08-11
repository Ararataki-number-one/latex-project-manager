import { randomBytes } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { MANIFEST_DIRECTORY, MANIFEST_FILE } from "../../shared/constants";
import { assetPinSchema, parseProjectManifest } from "../../shared/schema";
import type { AssetPin, TemplateInfo } from "../../shared/types";
import { hashFile, sha256Bytes } from "./files";
import { createProjectId } from "./project-id";

const METADATA_FILE = ".latex-template.json";
const GENERATED_EXTENSIONS = new Set([
  ".aux", ".log", ".fls", ".fdb_latexmk", ".synctex", ".toc", ".bbl", ".blg", ".idx", ".ind", ".ilg"
]);
const FONT_EXTENSIONS = new Set([".otf", ".ttf", ".ttc", ".woff", ".woff2"]);

interface StoredTemplate extends TemplateInfo {
  formatVersion: 1;
  createdAt: string;
}

const storedTemplateSchema = z.object({
  formatVersion: z.literal(1),
  createdAt: z.string().min(1),
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  description: z.string().max(1_000),
  rootPath: z.string().min(1),
  className: z.string().min(1).max(160).optional(),
  assetPins: z.array(assetPinSchema)
}).strict();

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "template";
}

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function shouldIgnore(relativePath: string, name: string): boolean {
  const portable = portablePath(relativePath);
  if (portable === METADATA_FILE) return true;
  if (portable === ".git" || portable.startsWith(".git/")) return true;
  if (portable === ".latex-workbench/build" || portable.startsWith(".latex-workbench/build/")) return true;
  if (portable === ".latex-workbench/snapshots" || portable.startsWith(".latex-workbench/snapshots/")) return true;
  if (name.endsWith(".synctex.gz")) return true;
  return GENERATED_EXTENSIONS.has(extname(name).toLowerCase());
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

async function copyTemplateTree(sourceRoot: string, destinationRoot: string, current = ""): Promise<void> {
  const sourceDirectory = join(sourceRoot, current);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    if (shouldIgnore(relativePath, entry.name)) continue;
    const source = join(sourceRoot, relativePath);
    const destination = join(destinationRoot, relativePath);
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Template creation refuses symbolic links: ${source}`);
    }
    if (metadata.isDirectory()) {
      await mkdir(destination, { recursive: true });
      await copyTemplateTree(sourceRoot, destinationRoot, relativePath);
    } else if (metadata.isFile()) {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
  }
}

function pinKind(path: string): AssetPin["kind"] {
  const extension = extname(path).toLowerCase();
  if (extension === ".cls") return "class";
  if (FONT_EXTENSIONS.has(extension)) return "font";
  return "template";
}

async function allFiles(root: string, current = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, current), { withFileTypes: true })) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    if (relativePath === METADATA_FILE) continue;
    if (entry.isDirectory()) result.push(...await allFiles(root, relativePath));
    else if (entry.isFile()) result.push(relativePath);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

export async function pinTemplateAssets(root: string): Promise<AssetPin[]> {
  const pins: AssetPin[] = [];
  for (const relativePath of await allFiles(root)) {
    const portable = portablePath(relativePath);
    pins.push({
      id: `asset-${sha256Bytes(Buffer.from(portable, "utf8")).slice(0, 16)}`,
      kind: pinKind(relativePath),
      path: portable,
      hash: await hashFile(join(root, relativePath)),
      source: "template"
    });
  }
  return pins;
}

export async function verifyTemplateAssets(template: TemplateInfo): Promise<Array<{ path: string; expected: string; actual?: string }>> {
  const mismatches: Array<{ path: string; expected: string; actual?: string }> = [];
  let templateRoot: string;
  try {
    templateRoot = await realpath(template.rootPath);
  } catch {
    return template.assetPins.map((pin) => ({ path: pin.path, expected: pin.hash }));
  }
  for (const pin of template.assetPins) {
    // Resolve pinned files from the canonical root so Windows 8.3 aliases
    // (for example RUNNER~1 vs runneradmin) cannot look like path traversal.
    const absolutePath = resolve(templateRoot, pin.path);
    const relation = relative(templateRoot, absolutePath);
    if (relation.startsWith(`..${sep}`) || relation === "..") {
      mismatches.push({ path: pin.path, expected: pin.hash });
      continue;
    }
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        mismatches.push({ path: pin.path, expected: pin.hash });
        continue;
      }
      const assetRealPath = await realpath(absolutePath);
      const realRelation = relative(templateRoot, assetRealPath);
      if (realRelation.startsWith(`..${sep}`) || realRelation === ".." || realRelation === "") {
        mismatches.push({ path: pin.path, expected: pin.hash });
        continue;
      }
      const actual = await hashFile(absolutePath);
      if (actual !== pin.hash) mismatches.push({ path: pin.path, expected: pin.hash, actual });
    } catch {
      mismatches.push({ path: pin.path, expected: pin.hash });
    }
  }
  return mismatches;
}

async function verifyExactTemplateCopy(template: TemplateInfo, copiedRoot: string): Promise<void> {
  const expected = template.assetPins.map((pin) => pin.path).sort((left, right) => left.localeCompare(right));
  const actual = (await allFiles(copiedRoot)).map(portablePath).sort((left, right) => left.localeCompare(right));
  if (expected.length !== actual.length || expected.some((path, index) => path !== actual[index])) {
    const unexpected = actual.find((path) => !expected.includes(path));
    const missing = expected.find((path) => !actual.includes(path));
    throw new Error(`Template file set verification failed: ${unexpected ?? missing ?? "file count mismatch"}`);
  }
  const mismatches = await verifyTemplateAssets({ ...template, rootPath: copiedRoot });
  if (mismatches.length) throw new Error(`Template asset verification failed after copy: ${mismatches[0].path}`);
}

export class TemplateService {
  readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = resolve(rootPath);
  }

  async list(): Promise<TemplateInfo[]> {
    await mkdir(this.rootPath, { recursive: true });
    const templates: TemplateInfo[] = [];
    for (const entry of await readdir(this.rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".staging-")) continue;
      const templateRoot = join(this.rootPath, entry.name);
      try {
        const parsed = storedTemplateSchema.safeParse(JSON.parse(await readFile(join(templateRoot, METADATA_FILE), "utf8")));
        if (!parsed.success || parsed.data.id !== entry.name) continue;
        const stored = parsed.data as StoredTemplate;
        templates.push({ ...stored, rootPath: templateRoot });
      } catch {
        // An incomplete directory is not a usable template.
      }
    }
    return templates.sort((left, right) => left.name.localeCompare(right.name));
  }

  async create(sourceRoot: string, name: string): Promise<TemplateInfo> {
    const source = resolve(sourceRoot);
    const sourceMetadata = await lstat(source);
    if (!sourceMetadata.isDirectory()) throw new Error(`Template source is not a directory: ${source}`);
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Template name cannot be empty.");

    await mkdir(this.rootPath, { recursive: true });
    const storeRelation = relative(source, this.rootPath);
    if (storeRelation === "" || (!storeRelation.startsWith(`..${sep}`) && storeRelation !== "..")) {
      throw new Error("The template store cannot be located inside the source project.");
    }
    const nonce = randomBytes(5).toString("hex");
    const id = `${slug(cleanName)}-${nonce}`;
    const destination = join(this.rootPath, id);
    const staging = join(this.rootPath, `.staging-${id}`);
    let stagingExists = false;
    try {
      await mkdir(staging, { recursive: false });
      stagingExists = true;
      await copyTemplateTree(source, staging);
      const assetPins = await pinTemplateAssets(staging);
      const classPin = assetPins.find((pin) => pin.kind === "class");
      const template: StoredTemplate = {
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        id,
        name: cleanName,
        description: `Local template created from ${basename(source)}`,
        rootPath: destination,
        className: classPin ? basename(classPin.path, extname(classPin.path)) : undefined,
        assetPins
      };
      await writeFile(join(staging, METADATA_FILE), `${JSON.stringify(template, null, 2)}\n`, "utf8");
      await rename(staging, destination);
      stagingExists = false;
      return template;
    } finally {
      if (stagingExists) await rm(staging, { recursive: true, force: true });
    }
  }

  async instantiate(templateId: string, parentRoot: string, name: string): Promise<string> {
    const template = (await this.list()).find((item) => item.id === templateId);
    if (!template) throw new Error("The selected template no longer exists.");
    const mismatches = await verifyTemplateAssets(template);
    if (mismatches.length) throw new Error(`Template asset verification failed: ${mismatches[0].path}`);

    const parent = await realpath(resolve(parentRoot));
    const store = await realpath(this.rootPath);
    if (isInside(store, parent)) throw new Error("A project cannot be created inside the template store.");
    const cleanName = projectDirectoryName(name);
    const destination = join(parent, cleanName);
    if (!isInside(parent, destination) || destination === parent) throw new Error("The project destination escapes its selected parent.");
    try {
      await lstat(destination);
      throw new Error(`The project destination already exists: ${destination}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const staging = join(parent, `.latex-workbench-new-${randomBytes(8).toString("hex")}`);
    let stagingExists = false;
    try {
      await mkdir(staging, { recursive: false });
      stagingExists = true;
      await copyTemplateTree(template.rootPath, staging);
      await verifyExactTemplateCopy(template, staging);

      const manifestPath = join(staging, MANIFEST_DIRECTORY, MANIFEST_FILE);
      try {
        const stored = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
        const now = new Date().toISOString();
        const manifest = parseProjectManifest({
          ...stored,
          projectId: createProjectId(),
          name: cleanName,
          createdAt: now,
          updatedAt: now
        });
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }

      await rename(staging, destination);
      stagingExists = false;
      return destination;
    } finally {
      if (stagingExists) await rm(staging, { recursive: true, force: true });
    }
  }
}

export const listTemplates = (rootPath: string): Promise<TemplateInfo[]> => new TemplateService(rootPath).list();
export const createTemplate = (rootPath: string, sourceRoot: string, name: string): Promise<TemplateInfo> =>
  new TemplateService(rootPath).create(sourceRoot, name);
