import type { BuildProblem } from "../../shared/types";

const FILE_LINE_PATTERN = /^(.+\.(?:tex|ltx|sty|cls|bib|bbx|cbx)):(\d+)(?::(\d+))?:\s*(.+)$/i;
const WARNING_PATTERN = /(?:^|\s)(?:LaTeX|Package\s+\S+|Class\s+\S+|pdfTeX|LuaTeX|XeTeX)?\s*Warning\s*:/i;
const LINE_REFERENCE_PATTERN = /(?:on input line|at line|l\.)\s*(\d+)/i;

function cleanMessage(message: string): string {
  return message.replace(/^!\s*/, "").trim();
}

function severityFor(message: string): BuildProblem["severity"] {
  if (WARNING_PATTERN.test(message) || /^(?:Over|Under)full \\[hv]box/i.test(message)) {
    return "warning";
  }
  if (/^(?:info|notice)\s*:/i.test(message)) {
    return "info";
  }
  return "error";
}

function parseCompleteLine(line: string): BuildProblem | null {
  const normalized = line.replace(/\r$/, "").trim();
  if (!normalized) {
    return null;
  }

  const fileLine = normalized.match(FILE_LINE_PATTERN);
  if (fileLine) {
    const message = cleanMessage(fileLine[4]);
    return {
      severity: severityFor(message),
      file: fileLine[1],
      line: Number(fileLine[2]),
      column: fileLine[3] ? Number(fileLine[3]) : undefined,
      message,
      raw: line
    };
  }

  if (WARNING_PATTERN.test(normalized) || /^(?:Over|Under)full \\[hv]box/i.test(normalized)) {
    const lineReference = normalized.match(LINE_REFERENCE_PATTERN);
    return {
      severity: "warning",
      line: lineReference ? Number(lineReference[1]) : undefined,
      message: cleanMessage(normalized),
      raw: line
    };
  }

  if (/^!\s*(?:LaTeX|Package|Class)?\s*(?:Error\s*:)?/i.test(normalized)) {
    return {
      severity: "error",
      message: cleanMessage(normalized),
      raw: line
    };
  }

  if (/^(?:Emergency stop|Fatal error occurred|No pages of output)/i.test(normalized)) {
    return {
      severity: "error",
      message: cleanMessage(normalized),
      raw: line
    };
  }

  return null;
}

/**
 * Incrementally parses latexmk output without losing diagnostics split across
 * stdout chunks. `finish` must be called once when the child exits.
 */
export class BuildLogParser {
  private buffered = "";

  push(chunk: string): BuildProblem[] {
    const text = this.buffered + chunk;
    const lines = text.split(/\n/);
    this.buffered = lines.pop() ?? "";
    return lines.flatMap((line) => {
      const problem = parseCompleteLine(line);
      return problem ? [problem] : [];
    });
  }

  finish(): BuildProblem[] {
    const finalLine = this.buffered;
    this.buffered = "";
    if (!finalLine) {
      return [];
    }
    const problem = parseCompleteLine(finalLine);
    return problem ? [problem] : [];
  }
}

export function parseBuildLog(log: string): BuildProblem[] {
  const parser = new BuildLogParser();
  return [...parser.push(`${log}\n`), ...parser.finish()];
}

export const parseLatexLog = parseBuildLog;
