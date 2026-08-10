import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectManifest, ProjectSummary } from "../../shared/types";
import type { ProjectCatalog } from "./catalog";
import { readTextFile } from "./encoding";
import { readProjectManifest } from "./manifest";
import { parseTexSource, resolveProjectPath } from "./scanner";

export interface RelinkDestination {
  rootPath: string;
  manifest: ProjectManifest;
}

function rootKey(rootPath: string): string {
  const normalized = resolve(rootPath);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export async function validateRelinkDestination(
  projectId: string,
  destinationRoot: string
): Promise<RelinkDestination> {
  const rootPath = await realpath(destinationRoot);
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("The selected project root must be a regular directory.");
  }

  const manifest = await readProjectManifest(rootPath);
  if (manifest.projectId !== projectId) {
    throw new Error("The selected folder contains a manifest for a different project.");
  }

  for (const target of manifest.targets) {
    const entryPath = resolveProjectPath(rootPath, target.entry);
    const entryInfo = await lstat(entryPath);
    if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
      throw new Error(`Document target is not a regular file: ${target.entry}`);
    }
    const parsed = parseTexSource((await readTextFile(entryPath)).content);
    if (!parsed.classDeclaration || !parsed.hasDocumentBegin) {
      throw new Error(`Document target is not a compilable LaTeX entry: ${target.entry}`);
    }
  }

  return { rootPath, manifest };
}

export async function relinkCatalogProject(
  catalog: ProjectCatalog,
  projectId: string,
  destinationRoot: string
): Promise<ProjectSummary> {
  if (!catalog.get(projectId)) {
    throw new Error(`The project is not registered in the library: ${projectId}`);
  }
  const destination = await validateRelinkDestination(projectId, destinationRoot);
  const occupied = catalog.list().find(
    (project) => project.id !== projectId && rootKey(project.rootPath) === rootKey(destination.rootPath)
  );
  if (occupied) {
    throw new Error(`The selected folder is already registered as project: ${occupied.id}`);
  }
  return catalog.relink(projectId, destination.rootPath);
}
