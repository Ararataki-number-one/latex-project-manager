import { describe, expect, it } from "vitest";
import { BuildLogParser, parseBuildLog } from "../src/main/services/log-parser";

describe("LaTeX build log parser", () => {
  it("parses Windows file:line:column diagnostics", () => {
    const problems = parseBuildLog("C:\\notes\\chapter.tex:42:7: Undefined control sequence.\n");
    expect(problems).toEqual([
      expect.objectContaining({
        severity: "error",
        file: "C:\\notes\\chapter.tex",
        line: 42,
        column: 7,
        message: "Undefined control sequence."
      })
    ]);
  });

  it("keeps partial lines between process chunks", () => {
    const parser = new BuildLogParser();
    expect(parser.push("./main.tex:9: LaTeX Er")).toEqual([]);
    expect(parser.push("ror: Missing $ inserted.\n")).toEqual([
      expect.objectContaining({ file: "./main.tex", line: 9, severity: "error" })
    ]);
  });

  it("classifies package warnings and fatal TeX messages", () => {
    const problems = parseBuildLog([
      "Package hyperref Warning: Token not allowed on input line 18.",
      "! LaTeX Error: File `missing.sty' not found.",
      "Emergency stop."
    ].join("\n"));
    expect(problems.map((problem) => problem.severity)).toEqual(["warning", "error", "error"]);
    expect(problems[0].line).toBe(18);
  });
});

