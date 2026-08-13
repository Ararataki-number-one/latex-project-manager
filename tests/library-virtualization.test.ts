import { describe, expect, it } from "vitest";
import { calculateVirtualRange, PROJECT_VIRTUALIZATION_THRESHOLD } from "../src/renderer/library-virtualization";

describe("project library virtualization", () => {
  it("keeps a 500-project library within a small DOM window", () => {
    const range = calculateVirtualRange({
      itemCount: 500,
      rowHeight: 82,
      scrollTop: 0,
      viewportHeight: 720
    });

    expect(PROJECT_VIRTUALIZATION_THRESHOLD).toBeLessThan(500);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(16);
    expect(range.offsetBottom).toBe((500 - range.endIndex) * 82);
  });

  it("preserves the full scroll geometry in the middle and at the end", () => {
    const middle = calculateVirtualRange({
      itemCount: 500,
      rowHeight: 66,
      scrollTop: 14_300,
      viewportHeight: 600
    });
    expect(middle.startIndex).toBeGreaterThan(0);
    expect(middle.endIndex).toBeLessThan(500);
    expect(middle.offsetTop + (middle.endIndex - middle.startIndex) * 66 + middle.offsetBottom).toBe(500 * 66);

    const end = calculateVirtualRange({
      itemCount: 500,
      rowHeight: 66,
      scrollTop: 500 * 66,
      viewportHeight: 600
    });
    expect(end.endIndex).toBe(500);
    expect(end.offsetBottom).toBe(0);
  });

  it("returns an empty, bounded range for an empty library", () => {
    expect(calculateVirtualRange({ itemCount: 0, rowHeight: 0, scrollTop: -1, viewportHeight: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      offsetBottom: 0
    });
  });
});
