import type { ProjectManifest } from "../shared/types";

type ManifestWriter = (manifest: ProjectManifest) => Promise<ProjectManifest>;

/** Serializes debounced and explicit saves so a build can flush the newest manifest. */
export class ManifestPersistenceCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<void>>();
  private persistedVersion = "";

  constructor(private readonly writer: ManifestWriter) {}

  markPersisted(version: string): void {
    this.persistedVersion = version;
  }

  save(manifest: ProjectManifest): Promise<void> {
    const version = manifest.updatedAt;
    if (this.persistedVersion === version) return Promise.resolve();
    const existing = this.pending.get(version);
    if (existing) return existing;

    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (this.persistedVersion === version) return;
        await this.writer(structuredClone(manifest));
        this.persistedVersion = version;
      });
    this.tail = operation;
    this.pending.set(version, operation);
    void operation.finally(() => {
      if (this.pending.get(version) === operation) this.pending.delete(version);
    }).catch(() => undefined);
    return operation;
  }

  flush(manifest: ProjectManifest): Promise<void> {
    return this.save(manifest);
  }
}

export async function flushLatestManifest(
  coordinator: ManifestPersistenceCoordinator,
  getLatest: () => ProjectManifest | null
): Promise<ProjectManifest> {
  while (true) {
    const snapshot = getLatest();
    if (!snapshot) throw new Error("The project manifest is not loaded.");
    await coordinator.flush(snapshot);
    if (getLatest()?.updatedAt === snapshot.updatedAt) return snapshot;
  }
}
