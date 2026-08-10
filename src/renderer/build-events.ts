import type { BuildEvent } from "../shared/types";

function normalizedRoot(rootPath: string): string {
  const portable = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(portable) || portable.startsWith("//")
    ? portable.toLocaleLowerCase("en-US")
    : portable;
}

export function isBuildEventForProject(event: BuildEvent, projectRoot: string): boolean {
  return normalizedRoot(event.projectRoot) === normalizedRoot(projectRoot);
}

export function isTerminalBuildEvent(event: BuildEvent): boolean {
  return ["success", "warning", "failed", "cancelled"].includes(event.status);
}
