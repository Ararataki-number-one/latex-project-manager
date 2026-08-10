import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

import {
  ELEGANTBOOK_CLASS_PACKAGES,
} from "../../shared/elegantbook";
import { MANIFEST_DIRECTORY, MANIFEST_FILE, SCHEMA_VERSION } from "../../shared/constants";
import { parseProjectManifest } from "../../shared/schema";
import type {
  AssetPin,
  BuildProfile,
  ClassConfig,
  DocumentTarget,
  PackageSpec,
  ProjectManifest,
  ScanCandidate,
  StructureNode
} from "../../shared/types";
import { readTextFile, writeTextFileAtomic } from "./encoding";
import { hashFile, stableId } from "./hashing";
import { createProjectId } from "./project-id";
import {
  isSafeRelativePath,
  maskLatexComments,
  parseTexSource,
  resolveIncludedTexPath,
  resolveProjectPath,
  type ParsedStructureCommand
} from "./scanner";

export function getManifestPath(projectRoot: string): string {
  return resolve(projectRoot, MANIFEST_DIRECTORY, MANIFEST_FILE);
}

function slashPath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

async function assertManagedDirectoryIsSafe(projectRoot: string): Promise<void> {
  const root = await realpath(projectRoot);
  const managedDirectory = resolve(root, MANIFEST_DIRECTORY);
  try {
    const info = await lstat(managedDirectory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`${MANIFEST_DIRECTORY} 必须是项目内的普通目录，不能是符号链接。`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function classOptions(rawOptions: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const option of rawOptions) {
    const equalAt = option.indexOf("=");
    if (equalAt < 0) result[option] = true;
    else {
      const key = option.slice(0, equalAt).trim();
      if (key) result[key] = option.slice(equalAt + 1).trim();
    }
  }
  return result;
}

function packageSpecs(targetSeed: string, className: string, parsed: ReturnType<typeof parseTexSource>): PackageSpec[] {
  const specs: PackageSpec[] = [];
  const nameCounts = new Map<string, number>();
  let order = 0;

  for (const declaration of parsed.packageDeclarations) {
    for (const packageName of declaration.names) {
      const normalizedName = packageName.trim();
      if (!normalizedName) continue;
      const count = (nameCounts.get(normalizedName) ?? 0) + 1;
      nameCounts.set(normalizedName, count);
      specs.push({
        id: stableId("package", `${targetSeed}:${normalizedName}:${count}`),
        name: normalizedName,
        options: declaration.options,
        enabled: true,
        order: order++,
        source: declaration.conditional ? "manual" : "managed",
        condition: declaration.condition,
        diagnostic: count > 1 ? "duplicate" : "ok"
      });
    }
  }

  if (className.toLowerCase() === "elegantbook") {
    const declaredNames = new Set(specs.map((item) => item.name.toLowerCase()));
    for (const packageName of ELEGANTBOOK_CLASS_PACKAGES) {
      specs.push({
        id: stableId("class-package", `${targetSeed}:${packageName}`),
        name: packageName,
        options: [],
        enabled: true,
        order: order++,
        source: "class",
        diagnostic: declaredNames.has(packageName.toLowerCase()) ? "duplicate" : "ok"
      });
    }
  }

  if ([...nameCounts.values()].some((count) => count > 1)) {
    for (const spec of specs) {
      if ((nameCounts.get(spec.name) ?? 0) > 1) spec.diagnostic = "duplicate";
    }
  }
  return specs;
}

function phaseForCommand(
  phase: StructureNode["phase"],
  command: ParsedStructureCommand
): StructureNode["phase"] {
  if (command.kind === "frontmatter") return "frontmatter";
  if (command.kind === "mainmatter") return "mainmatter";
  if (command.kind === "appendix") return "appendix";
  if (command.kind === "backmatter") return "backmatter";
  return phase;
}

async function includedTitle(projectRoot: string, filePath: string): Promise<{ title?: string; heading?: string }> {
  try {
    const fileInfo = await lstat(filePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return {};
    const canonicalPath = await realpath(filePath);
    resolveProjectPath(projectRoot, slashPath(projectRoot, canonicalPath));
    const source = await readTextFile(filePath);
    const parsed = parseTexSource(source.content);
    const chapter = parsed.structureCommands.find((item) => item.kind === "chapter");
    return chapter ? { title: chapter.title, heading: chapter.raw } : {};
  } catch {
    return {};
  }
}

function onlyWhitespaceOrComments(source: string): boolean {
  return maskLatexComments(source).trim().length === 0;
}

async function buildStructure(
  projectRoot: string,
  entryPath: string,
  parsed: ReturnType<typeof parseTexSource>,
  targetSeed: string
): Promise<StructureNode[]> {
  const nodes: StructureNode[] = [];
  const entryDirectory = dirname(entryPath);
  let phase: StructureNode["phase"] = "frontmatter";
  let chapterNumber = 0;
  const occurrences = new Map<string, number>();

  for (let index = 0; index < parsed.structureCommands.length; index += 1) {
    const command = parsed.structureCommands[index];
    phase = phaseForCommand(phase, command);

    const next = parsed.structureCommands[index + 1];
    const mergesWithInput =
      command.kind === "chapter" &&
      next?.kind === "input" &&
      onlyWhitespaceOrComments(parsed.source.slice(command.end, next.start));

    let path: string | undefined;
    let title = command.title;
    let titleSource: StructureNode["titleSource"] = command.kind === "chapter" ? "main" : "manual";
    let headingSource: string | undefined = command.kind === "chapter" ? command.raw : undefined;
    let contentSource: string | undefined;
    let kind = command.kind;

    if (mergesWithInput && next.path) {
      const included = resolveIncludedTexPath(projectRoot, entryDirectory, next.path);
      if (included) {
        path = slashPath(projectRoot, included);
        contentSource = path;
      }
      index += 1;
    } else if (command.kind === "input" && command.path) {
      const included = resolveIncludedTexPath(projectRoot, entryDirectory, command.path);
      if (included) {
        path = slashPath(projectRoot, included);
        const child = await includedTitle(projectRoot, included);
        if (child.title) {
          kind = "chapter";
          title = child.title;
          titleSource = "file";
          headingSource = child.heading;
          contentSource = path;
        } else {
          titleSource = "dynamic";
          contentSource = path;
        }
      } else {
        titleSource = "dynamic";
      }
    }

    if (kind === "chapter" && !command.starred) chapterNumber += 1;
    const identity = `${kind}:${path ?? title}`;
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    nodes.push({
      id: stableId("node", `${targetSeed}:${identity}:${occurrence}`),
      kind,
      title,
      path,
      phase,
      order: nodes.length,
      originalNumber: kind === "chapter" && !command.starred ? chapterNumber : undefined,
      titleSource,
      headingSource,
      contentSource,
      managed: true
    });
  }

  return nodes;
}

function defaultProfile(targetId: string, structure: StructureNode[]): BuildProfile {
  return {
    id: stableId("profile", `${targetId}:default`),
    name: "完整文档",
    chapterState: Object.fromEntries(
      structure.filter((node) => node.kind === "chapter" || node.kind === "input").map((node) => [node.id, "full" as const])
    ),
    numbering: "preserve",
    enabledBlocks: { class: true, packages: true, structure: true },
    order: structure.map((node) => node.id),
    autoCompile: false
  };
}

async function classConfiguration(
  projectRoot: string,
  className: string,
  rawOptions: string[]
): Promise<{ config: ClassConfig; pin?: AssetPin }> {
  const relativeClassPath = `${className}.cls`;
  if (isSafeRelativePath(relativeClassPath)) {
    const localClassPath = resolveProjectPath(projectRoot, relativeClassPath);
    try {
      const localClassInfo = await lstat(localClassPath);
      if (localClassInfo.isFile() && !localClassInfo.isSymbolicLink()) {
        const hash = await hashFile(localClassPath);
        return {
          config: {
            name: className,
            options: classOptions(rawOptions),
            rawOptions,
            source: "project",
            sourcePath: relativeClassPath,
            sourceHash: hash
          },
          pin: {
            id: stableId("asset", `class:${relativeClassPath}`),
            kind: "class",
            path: relativeClassPath,
            hash,
            source: "project"
          }
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return {
    config: {
      name: className,
      options: classOptions(rawOptions),
      rawOptions,
      source: "unknown"
    }
  };
}

async function targetFromEntry(
  projectRoot: string,
  entryRelativePath: string,
  engineHint: DocumentTarget["engine"] = "auto"
): Promise<{ target: DocumentTarget; pin?: AssetPin }> {
  const entryPath = resolveProjectPath(projectRoot, entryRelativePath);
  const source = await readTextFile(entryPath);
  const parsed = parseTexSource(source.content);
  if (!parsed.classDeclaration || !parsed.hasDocumentBegin) {
    throw new Error(`不是可导入的主 TeX 文件（缺少 documentclass 或 document 环境）: ${entryRelativePath}`);
  }

  const targetId = stableId("target", entryRelativePath.toLowerCase());
  const classResult = await classConfiguration(
    projectRoot,
    parsed.classDeclaration.name,
    parsed.classDeclaration.options
  );
  const structure = await buildStructure(projectRoot, entryPath, parsed, entryRelativePath);
  const name = basename(entryRelativePath, extname(entryRelativePath));
  return {
    target: {
      id: targetId,
      name,
      entry: entryRelativePath.split("\\").join("/"),
      engine: parsed.magicEngine === "auto" ? engineHint : parsed.magicEngine,
      classConfig: classResult.config,
      packages: packageSpecs(entryRelativePath, parsed.classDeclaration.name, parsed),
      structure,
      profiles: [defaultProfile(targetId, structure)]
    },
    pin: classResult.pin
  };
}

export async function createProjectManifest(
  candidate: ScanCandidate,
  existing?: ProjectManifest,
  projectId = existing?.projectId ?? createProjectId()
): Promise<ProjectManifest> {
  const projectRoot = await realpath(candidate.rootPath);
  const targetResults = await Promise.all(
    candidate.entries.map((entry) => targetFromEntry(projectRoot, entry.relativePath, entry.engine))
  );
  if (targetResults.length === 0) throw new Error("项目至少需要一个可编译文档目标。");

  const now = new Date().toISOString();
  const pins = new Map<string, AssetPin>();
  for (const result of targetResults) if (result.pin) pins.set(result.pin.id, result.pin);

  return parseProjectManifest({
    schemaVersion: SCHEMA_VERSION,
    projectId: existing?.projectId ?? projectId,
    name: existing?.name ?? candidate.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    targets: targetResults.map((result) => result.target),
    assets: [...pins.values()]
  });
}

export async function createManifestFromEntry(
  projectRoot: string,
  entryRelativePath: string,
  projectName = basename(resolve(projectRoot)),
  projectId?: string
): Promise<ProjectManifest> {
  const absoluteRoot = await realpath(projectRoot);
  const entryPath = resolveProjectPath(absoluteRoot, entryRelativePath);
  const source = await readTextFile(entryPath);
  const parsed = parseTexSource(source.content);
  if (!parsed.classDeclaration) throw new Error(`找不到 \\documentclass: ${entryRelativePath}`);
  return createProjectManifest(
    {
      rootPath: absoluteRoot,
      name: projectName,
      entries: [
        {
          path: entryPath,
          relativePath: entryRelativePath.split("\\").join("/"),
          engine: parsed.magicEngine,
          className: parsed.classDeclaration.name,
          classOptions: parsed.classDeclaration.options
        }
      ]
    },
    undefined,
    projectId
  );
}

export async function readProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  await assertManagedDirectoryIsSafe(projectRoot);
  const raw = await readFile(getManifestPath(projectRoot), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`项目 manifest 不是有效 JSON: ${(error as Error).message}`);
  }
  return parseProjectManifest(value);
}

export async function readProjectManifestIfExists(projectRoot: string): Promise<ProjectManifest | null> {
  try {
    return await readProjectManifest(projectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeProjectManifest(
  projectRoot: string,
  manifest: ProjectManifest,
  expectedHash?: string | null
): Promise<ProjectManifest> {
  const parsed = parseProjectManifest(manifest);
  await assertManagedDirectoryIsSafe(projectRoot);
  await mkdir(resolve(projectRoot, MANIFEST_DIRECTORY), { recursive: true });
  await writeTextFileAtomic(getManifestPath(projectRoot), `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    lineEnding: "lf",
    expectedHash,
    normalizeLineEndings: true
  });
  return parsed;
}

export const loadManifest = readProjectManifest;
export const saveManifest = writeProjectManifest;
export const generateManifest = createProjectManifest;
