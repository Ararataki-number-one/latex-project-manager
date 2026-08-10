import { describe, expect, it } from "vitest";
import { parseSyncTexEdit, parseSyncTexView } from "../src/main/services/synctex";
import { remapSyncTexInputText } from "../src/main/services/build";

describe("SyncTeX output parsing", () => {
  it("parses forward view coordinates", () => {
    const location = parseSyncTexView([
      "SyncTeX result begin",
      "Output:workbench.pdf",
      "Page:3",
      "x:120.5",
      "y:240.25",
      "W:32",
      "H:14",
      "SyncTeX result end"
    ].join("\n"), "C:\\book\\chapter.tex", 27, 4);
    expect(location).toEqual(expect.objectContaining({ page: 3, x: 120.5, y: 240.25, line: 27, column: 4 }));
  });

  it("parses backward edit locations with drive-letter paths", () => {
    const location = parseSyncTexEdit([
      "SyncTeX result begin",
      "Input:C:\\book\\chapter.tex",
      "Line:88",
      "Column:2",
      "SyncTeX result end"
    ].join("\n"));
    expect(location).toEqual({ file: "C:\\book\\chapter.tex", line: 88, column: 2 });
  });

  it("maps the generated entry back to the original main source", () => {
    const text = [
      "SyncTeX Version:1",
      "Input:1:C:/book/.latex-workbench/build/target/profile/./latex-workbench-entry.tex",
      "Input:2:C:/book/chapters/one.tex"
    ].join("\n");
    const mapped = remapSyncTexInputText(
      text,
      "C:\\book\\.latex-workbench\\build\\target\\profile\\latex-workbench-entry.tex",
      "C:\\book\\main.tex"
    );
    expect(mapped).toContain("Input:1:C:/book/main.tex");
    expect(mapped).toContain("Input:2:C:/book/chapters/one.tex");
  });
});
