import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import type { SyncTexLocation } from "../../shared/types";
import { detectToolchains } from "./toolchain";

type SyncTexCommandResolver = () => Promise<string | null>;

interface SyncTexFields {
  [key: string]: string;
}

function resultFields(output: string): SyncTexFields {
  const begin = output.indexOf("SyncTeX result begin");
  const end = output.indexOf("SyncTeX result end", begin >= 0 ? begin : 0);
  const result = begin >= 0 ? output.slice(begin, end >= 0 ? end : undefined) : output;
  const fields: SyncTexFields = {};
  for (const line of result.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && value && fields[key] === undefined) fields[key] = value;
  }
  return fields;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSyncTexView(
  output: string,
  sourceFile = "",
  sourceLine = 1,
  sourceColumn?: number
): SyncTexLocation | null {
  const fields = resultFields(output);
  const page = finiteNumber(fields.Page);
  if (page === undefined) return null;
  return {
    file: sourceFile,
    line: sourceLine,
    column: sourceColumn,
    page,
    x: finiteNumber(fields.x) ?? finiteNumber(fields.h),
    y: finiteNumber(fields.y) ?? finiteNumber(fields.v),
    width: finiteNumber(fields.W),
    height: finiteNumber(fields.H)
  };
}

export function parseSyncTexEdit(output: string): SyncTexLocation | null {
  const fields = resultFields(output);
  const file = fields.Input;
  const line = finiteNumber(fields.Line);
  if (!file || line === undefined) return null;
  return {
    file,
    line,
    column: finiteNumber(fields.Column)
  };
}

function execute(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim();
          reject(new Error(`SyncTeX failed: ${detail}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

async function defaultCommandResolver(): Promise<string | null> {
  const toolchains = await detectToolchains();
  return toolchains.find((toolchain) => toolchain.synctex)?.synctex ?? null;
}

export class SyncTexService {
  constructor(private readonly resolveCommand: SyncTexCommandResolver = defaultCommandResolver) {}

  async forward(
    sourcePath: string,
    line: number,
    column: number,
    pdfPath: string
  ): Promise<SyncTexLocation | null> {
    const command = await this.requiredCommand();
    const { stdout, stderr } = await execute(command, [
      "view",
      "-i",
      `${Math.max(1, Math.trunc(line))}:${Math.max(0, Math.trunc(column))}:${sourcePath}`,
      "-o",
      pdfPath
    ]);
    return parseSyncTexView(`${stdout}\n${stderr}`, sourcePath, line, column);
  }

  async backward(pdfPath: string, page: number, x: number, y: number): Promise<SyncTexLocation | null> {
    const command = await this.requiredCommand();
    const { stdout, stderr } = await execute(command, [
      "edit",
      "-o",
      `${Math.max(1, Math.trunc(page))}:${x}:${y}:${pdfPath}`
    ]);
    return parseSyncTexEdit(`${stdout}\n${stderr}`);
  }

  private async requiredCommand(): Promise<string> {
    const command = await this.resolveCommand();
    if (!command || !isAbsolute(command)) {
      throw new Error("SyncTeX is unavailable. Configure an absolute TeX distribution path first.");
    }
    return command;
  }
}

export const parseViewOutput = parseSyncTexView;
export const parseEditOutput = parseSyncTexEdit;
