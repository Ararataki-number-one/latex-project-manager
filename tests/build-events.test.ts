import { describe, expect, it } from "vitest";

import { isBuildEventForProject } from "../src/renderer/build-events";
import type { BuildEvent } from "../src/shared/types";

function event(projectRoot: string, buildId: string): BuildEvent {
  return {
    buildId,
    projectRoot,
    targetId: "main",
    profileId: "full",
    status: "running",
    logChunk: `${buildId}\n`
  };
}

describe("project-scoped build events", () => {
  it("keeps concurrent logs and build IDs out of the other project view", () => {
    const projectA = "C:\\notes\\probability";
    const projectB = "C:\\notes\\ramsey";
    const events = [
      event(projectA, "build-a-queued"),
      event(projectB, "build-b-running"),
      event("c:/NOTES/probability/", "build-a-running")
    ];

    const accepted = events.filter((item) => isBuildEventForProject(item, projectA));
    expect(accepted.map((item) => item.buildId)).toEqual(["build-a-queued", "build-a-running"]);
    expect(accepted.map((item) => item.logChunk).join("")).not.toContain("build-b");
  });
});
