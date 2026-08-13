import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const RESOURCE_DIRECTORIES = ["github-sync", "project-backups", "templates"] as const;

export interface PortableResourceMigrationEntry {
  sourcePath: string;
  destinationPath: string;
  relativePath: string;
}

export interface PortableResourceMigrationPlan {
  targetUserData: string;
  entries: PortableResourceMigrationEntry[];
  conflicts: string[];
  skipped: string[];
}

export interface PortableResourceMigrationResult {
  copied: number;
  conflicts: string[];
  failures: string[];
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !/^[a-zA-Z]:|^[\\/]/.test(relation));
}

function portable(value: string): string {
  return value.split(sep).join("/");
}

/** Builds a read-only, conflict-aware plan for local data not stored in SQLite. */
export async function previewPortableResourceMigration(
  sourceUserDataDirectories: readonly string[],
  targetUserDataDirectory: string
): Promise<PortableResourceMigrationPlan> {
  const targetUserData = resolve(targetUserDataDirectory);
  const entries: PortableResourceMigrationEntry[] = [];
  const conflicts: string[] = [];
  const skipped: string[] = [];
  const claimedDestinations = new Set<string>();

  const visit = async (sourceRoot: string, directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const sourcePath = join(directory, entry.name);
      const relativePath = portable(relative(sourceRoot, sourcePath));
      if (entry.isSymbolicLink()) {
        skipped.push(`${relativePath} (symbolic link)`);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(sourceRoot, sourcePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const destinationPath = resolve(targetUserData, ...relativePath.split("/"));
      if (!isInside(targetUserData, destinationPath)) {
        skipped.push(`${relativePath} (unsafe path)`);
        continue;
      }
      const key = process.platform === "win32"
        ? destinationPath.toLocaleLowerCase("en-US")
        : destinationPath;
      if (claimedDestinations.has(key) || await lstat(destinationPath).then(() => true, () => false)) {
        conflicts.push(relativePath);
        continue;
      }
      claimedDestinations.add(key);
      entries.push({ sourcePath, destinationPath, relativePath });
    }
  };

  const uniqueSources = [...new Set(sourceUserDataDirectories.map((directory) => resolve(directory)))]
    .filter((directory) => directory !== targetUserData);
  for (const sourceUserData of uniqueSources) {
    for (const resource of RESOURCE_DIRECTORIES) {
      const sourceRoot = join(sourceUserData, resource);
      if (!await lstat(sourceRoot).then((value) => value.isDirectory() && !value.isSymbolicLink(), () => false)) continue;
      await visit(sourceUserData, sourceRoot);
    }
  }
  return { targetUserData, entries, conflicts: [...new Set(conflicts)], skipped: [...new Set(skipped)] };
}

/** Copies only files that are still missing at apply time; target data always wins. */
export async function applyPortableResourceMigration(
  plan: PortableResourceMigrationPlan
): Promise<PortableResourceMigrationResult> {
  const conflicts = [...plan.conflicts];
  const failures = [...plan.skipped];
  let copied = 0;
  for (const entry of plan.entries) {
    const destination = resolve(entry.destinationPath);
    if (!isInside(plan.targetUserData, destination)) {
      failures.push(`${entry.relativePath}: unsafe destination`);
      continue;
    }
    try {
      const sourceBefore = await lstat(entry.sourcePath);
      if (!sourceBefore.isFile() || sourceBefore.isSymbolicLink()) {
        failures.push(`${entry.relativePath}: source is no longer a regular file`);
        continue;
      }
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(entry.sourcePath, destination, constants.COPYFILE_EXCL);
      const [sourceAfter, destinationAfter] = await Promise.all([stat(entry.sourcePath), stat(destination)]);
      if (sourceAfter.size !== sourceBefore.size || sourceAfter.mtimeMs !== sourceBefore.mtimeMs
        || destinationAfter.size !== sourceBefore.size) {
        await rm(destination, { force: true }).catch(() => undefined);
        failures.push(`${entry.relativePath}: source changed while copying`);
        continue;
      }
      copied += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") conflicts.push(entry.relativePath);
      else failures.push(`${entry.relativePath}: ${error instanceof Error ? error.message : "copy failed"}`);
    }
  }
  return { copied, conflicts: [...new Set(conflicts)], failures: [...new Set(failures)] };
}
