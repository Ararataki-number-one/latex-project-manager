import { realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Renderer input is never an authority for a filesystem root.  This small
 * registry records roots that were either already in the catalog or selected
 * through a native dialog, and compares their canonical paths before an IPC
 * operation is allowed to use them.
 */
export class ProjectAccessError extends Error {
  constructor(message: string, public readonly code: "ROOT_NOT_AUTHORIZED" | "ROOT_UNAVAILABLE" | "PATH_NOT_AUTHORIZED") {
    super(message);
    this.name = "ProjectAccessError";
  }
}

function key(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function inside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

async function canonicalDirectory(path: string): Promise<string> {
  const lexical = resolve(path);
  let canonical: string;
  try {
    canonical = await realpath(lexical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectAccessError(`Project root is unavailable: ${lexical}`, "ROOT_UNAVAILABLE");
    }
    throw error;
  }
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) {
    throw new ProjectAccessError(`Project root is not a directory: ${lexical}`, "ROOT_UNAVAILABLE");
  }
  return canonical;
}

async function canonicalPath(path: string): Promise<string> {
  const lexical = resolve(path);
  try {
    return await realpath(lexical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectAccessError(`Path is unavailable: ${lexical}`, "PATH_NOT_AUTHORIZED");
    }
    throw error;
  }
}

export class ProjectAccessController {
  private readonly projectRoots = new Map<string, string>();
  private readonly selectionRoots = new Map<string, string>();
  private readonly pendingCandidates = new Map<string, string>();

  constructor(initialProjectRoots: string[] = []) {
    for (const root of initialProjectRoots) this.seedProjectRoot(root);
  }

  /** Seed a root from the persistent catalog without requiring it to exist. */
  seedProjectRoot(root: string): void {
    const lexical = resolve(root);
    let canonical = lexical;
    try {
      canonical = realpathSync.native(lexical);
    } catch {
      // An unavailable catalog root remains registered lexically and must be
      // explicitly relinked before it can be trusted again.
    }
    this.projectRoots.set(key(lexical), canonical);
    this.projectRoots.set(key(canonical), canonical);
  }

  removeProjectRoot(root: string): void {
    const lexical = resolve(root);
    const known = this.projectRoots.get(key(lexical));
    this.projectRoots.delete(key(lexical));
    if (known) this.projectRoots.delete(key(known));
  }

  async addProjectRoot(root: string): Promise<string> {
    const canonical = await canonicalDirectory(root);
    this.projectRoots.set(key(canonical), canonical);
    this.projectRoots.set(key(root), canonical);
    return canonical;
  }

  /** Record a native-dialog selection. A selection may be a library parent. */
  async addSelection(root: string): Promise<string> {
    const canonical = await canonicalDirectory(root);
    this.selectionRoots.set(key(canonical), canonical);
    this.selectionRoots.set(key(root), canonical);
    return canonical;
  }

  async requireSelection(root: string): Promise<string> {
    const canonical = await canonicalDirectory(root);
    for (const selected of this.selectionRoots.values()) {
      if (inside(selected, canonical)) return canonical;
    }
    throw new ProjectAccessError("The directory was not selected through the native folder dialog.", "ROOT_NOT_AUTHORIZED");
  }

  async requireProjectRoot(root: string): Promise<string> {
    const lexical = resolve(root);
    const known = this.projectRoots.get(key(lexical));
    if (known) {
      const canonical = await canonicalDirectory(lexical);
      if (key(canonical) !== key(known)) {
        throw new ProjectAccessError("The project root changed its canonical location.", "ROOT_NOT_AUTHORIZED");
      }
      return canonical;
    }

    const canonical = await canonicalDirectory(lexical);
    const canonicalKnown = this.projectRoots.get(key(canonical));
    if (!canonicalKnown) {
      throw new ProjectAccessError("The project root is not registered in the project library.", "ROOT_NOT_AUTHORIZED");
    }
    return canonical;
  }

  async registerPendingCandidate(root: string): Promise<string> {
    let canonical: string;
    try {
      canonical = await this.requireSelection(root);
    } catch (error) {
      if (!(error instanceof ProjectAccessError) || error.code !== "ROOT_NOT_AUTHORIZED") throw error;
      canonical = await this.requireProjectRoot(root);
    }
    this.pendingCandidates.set(key(canonical), canonical);
    return canonical;
  }

  async consumePendingCandidate(root: string): Promise<string> {
    const canonical = await canonicalDirectory(root);
    const pending = this.pendingCandidates.get(key(canonical));
    if (!pending) throw new ProjectAccessError("The scan result is stale; scan the selected directory again.", "ROOT_NOT_AUTHORIZED");
    this.pendingCandidates.delete(key(canonical));
    await this.addProjectRoot(canonical);
    return canonical;
  }

  /** Find the registered project containing a canonical file path. */
  async requireProjectForPath(path: string): Promise<{ root: string; path: string }> {
    const canonical = await canonicalPath(path);
    for (const root of new Set(this.projectRoots.values())) {
      if (inside(root, canonical)) return { root, path: canonical };
    }
    throw new ProjectAccessError("The path is outside every registered project.", "PATH_NOT_AUTHORIZED");
  }

  projectRootsList(): string[] {
    return [...new Set(this.projectRoots.values())];
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  return inside(resolve(root), resolve(candidate));
}
