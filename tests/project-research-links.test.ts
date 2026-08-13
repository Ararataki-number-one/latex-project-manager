import { describe, expect, it } from "vitest";

import {
  createResearchLinkDraft,
  materializeResearchLinks
} from "../src/renderer/ProjectResources";
import type { ResearchTargetLink } from "../src/shared/types";

describe("project research link drafts", () => {
  const original: ResearchTargetLink[] = [
    { targetId: "book-main", role: "primarySource", preferredAttachmentId: "source-pdf" },
    { targetId: "exercise-sheet", role: "supplement", preferredAttachmentId: "answer-pdf" }
  ];

  it("preserves every original link when only bibliographic metadata is edited", () => {
    const draft = createResearchLinkDraft(original, ["book-main", "exercise-sheet"]);
    expect(draft).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetKey: "book-main", enabled: true, role: "primarySource", preferredAttachmentId: "source-pdf" }),
      expect.objectContaining({ targetKey: "exercise-sheet", enabled: true, role: "supplement", preferredAttachmentId: "answer-pdf" })
    ]));
    expect(materializeResearchLinks(draft, original, false)).toEqual(original);
  });

  it("updates one target without flattening another target's role or preferred attachment", () => {
    const draft = createResearchLinkDraft(original, ["book-main", "exercise-sheet"])
      .map((entry) => entry.targetKey === "book-main"
        ? { ...entry, role: "translationSource" as const, preferredAttachmentId: "translation-pdf" }
        : entry);
    expect(materializeResearchLinks(draft, original, true)).toEqual([
      { targetId: "book-main", role: "translationSource", preferredAttachmentId: "translation-pdf" },
      { targetId: "exercise-sheet", role: "supplement", preferredAttachmentId: "answer-pdf" }
    ]);
  });
});
