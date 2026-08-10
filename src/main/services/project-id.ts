import { randomUUID } from "node:crypto";

/**
 * Project IDs identify a catalog entry and survive moving its root directory.
 * Generate one only when a project is first imported or instantiated.
 */
export function createProjectId(): string {
  return `project-${randomUUID()}`;
}
