import { lstat, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

import { DEFAULT_IGNORED_DIRECTORIES, DEFAULT_SCAN_DEPTH } from "../../shared/constants";
import type { Engine, ScanCandidate, ScanOptions, StructureKind } from "../../shared/types";
import { readTextFile, UnsupportedTextEncodingError } from "./encoding";

export interface SourceRange {
  start: number;
  end: number;
  raw: string;
}

export interface ParsedClassDeclaration extends SourceRange {
  name: string;
  options: string[];
}

export interface ParsedPackageDeclaration extends SourceRange {
  names: string[];
  options: string[];
  conditional: boolean;
  condition?: string;
}

export interface ParsedIncludeDeclaration extends SourceRange {
  command: "input" | "include" | "subfile";
  path: string;
}

export interface ParsedStructureCommand extends SourceRange {
  command: string;
  kind: StructureKind;
  title: string;
  path?: string;
  starred?: boolean;
}

export interface ParsedTexDocument {
  source: string;
  maskedSource: string;
  magicEngine: Engine;
  magicRoot?: string;
  classDeclaration?: ParsedClassDeclaration;
  packageDeclarations: ParsedPackageDeclaration[];
  includeDeclarations: ParsedIncludeDeclaration[];
  structureCommands: ParsedStructureCommand[];
  bibliographyResources: string[];
  hasDocumentBegin: boolean;
  documentBegin?: SourceRange;
  documentEnd?: SourceRange;
  warnings: string[];
}

const COMMAND_KIND: Record<string, StructureKind> = {
  maketitle: "title",
  frontmatter: "frontmatter",
  tableofcontents: "toc",
  localtableofcontents: "localToc",
  listoffigures: "listOfFigures",
  listoftables: "listOfTables",
  listofchanges: "listOfChanges",
  mainmatter: "mainmatter",
  part: "part",
  chapter: "chapter",
  appendix: "appendix",
  printbibliography: "bibliography",
  bibliography: "bibliography",
  printindex: "index",
  backmatter: "backmatter"
};

const COMMAND_TITLE: Record<string, string> = {
  maketitle: "标题页",
  frontmatter: "前置内容",
  tableofcontents: "总目录",
  localtableofcontents: "局部目录",
  listoffigures: "插图目录",
  listoftables: "表格目录",
  listofchanges: "变更记录",
  mainmatter: "正文",
  appendix: "附录",
  printbibliography: "参考文献",
  bibliography: "参考文献",
  printindex: "索引",
  backmatter: "后置内容"
};

export function maskLatexComments(source: string): string {
  // Work in UTF-16 code units so replacing astral characters inside comments
  // cannot shift the source offsets reported by JavaScript regular expressions.
  const chars = source.split("");
  let inComment = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (inComment) {
      if (char === "\n" || char === "\r") {
        inComment = false;
      } else {
        chars[index] = " ";
      }
      continue;
    }

    if (char !== "%") continue;
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && chars[cursor] === "\\"; cursor -= 1) slashCount += 1;
    if (slashCount % 2 === 0) {
      chars[index] = " ";
      inComment = true;
    }
  }

  return chars.join("");
}

export function splitLatexList(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{" && value[index - 1] !== "\\") braceDepth += 1;
    else if (char === "}" && value[index - 1] !== "\\") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "[" && value[index - 1] !== "\\") bracketDepth += 1;
    else if (char === "]" && value[index - 1] !== "\\") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "," && braceDepth === 0 && bracketDepth === 0) {
      const item = value.slice(start, index).trim();
      if (item) result.push(item);
      start = index + 1;
    }
  }

  const tail = value.slice(start).trim();
  if (tail) result.push(tail);
  return result;
}

function rangeFromMatch(source: string, match: RegExpExecArray): SourceRange {
  return { start: match.index, end: match.index + match[0].length, raw: source.slice(match.index, match.index + match[0].length) };
}

function conditionAt(maskedSource: string, offset: number): string | undefined {
  const stack: string[] = [];
  const tokenPattern = /\\(if[a-zA-Z@]*|else|fi)\b/g;
  const preamble = maskedSource.slice(0, offset);
  let token: RegExpExecArray | null;
  while ((token = tokenPattern.exec(preamble)) !== null) {
    if (token[1] === "fi") stack.pop();
    else if (token[1] !== "else") stack.push(token[1]);
  }
  return stack.length > 0 ? stack.map((name) => `\\${name}`).join(" / ") : undefined;
}

function magicComments(source: string): { engine: Engine; root?: string } {
  let engine: Engine = "auto";
  let root: string | undefined;
  for (const line of source.split(/\r?\n/).slice(0, 40)) {
    const programMatch = /^\s*%+\s*!\s*TeX\s+program\s*=\s*(.+?)\s*$/i.exec(line);
    if (programMatch) {
      const program = programMatch[1].toLowerCase();
      if (program.includes("xelatex")) engine = "xelatex";
      else if (program.includes("lualatex")) engine = "lualatex";
      else if (program.includes("pdflatex")) engine = "pdflatex";
    }
    const rootMatch = /^\s*%+\s*!\s*TeX\s+root\s*=\s*(.+?)\s*$/i.exec(line);
    if (rootMatch) root = rootMatch[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return { engine, root };
}

export function parseTexSource(source: string): ParsedTexDocument {
  const maskedSource = maskLatexComments(source);
  const magic = magicComments(source);
  const warnings: string[] = [];

  const classPattern = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/g;
  const classMatches = [...maskedSource.matchAll(classPattern)];
  const firstClass = classMatches[0];
  const classDeclaration = firstClass
    ? {
        ...rangeFromMatch(source, firstClass as RegExpExecArray),
        name: firstClass[2].trim(),
        options: splitLatexList(firstClass[1] ?? "")
      }
    : undefined;
  if (classMatches.length > 1) warnings.push("检测到多个未注释的 \\documentclass，已只读取第一个。");

  const packageDeclarations: ParsedPackageDeclaration[] = [];
  const packagePattern = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/g;
  let packageMatch: RegExpExecArray | null;
  while ((packageMatch = packagePattern.exec(maskedSource)) !== null) {
    const condition = conditionAt(maskedSource, packageMatch.index);
    packageDeclarations.push({
      ...rangeFromMatch(source, packageMatch),
      names: splitLatexList(packageMatch[2]),
      options: splitLatexList(packageMatch[1] ?? ""),
      conditional: Boolean(condition),
      condition
    });
  }

  const includeDeclarations: ParsedIncludeDeclaration[] = [];
  const includePattern = /\\(input|include|subfile)\s*\{([^{}]+)\}/g;
  let includeMatch: RegExpExecArray | null;
  while ((includeMatch = includePattern.exec(maskedSource)) !== null) {
    includeDeclarations.push({
      ...rangeFromMatch(source, includeMatch),
      command: includeMatch[1] as ParsedIncludeDeclaration["command"],
      path: includeMatch[2].trim()
    });
  }

  const structureCommands: ParsedStructureCommand[] = includeDeclarations.map((declaration) => ({
    ...declaration,
    command: declaration.command,
    kind: "input",
    title: declaration.path,
    path: declaration.path
  }));

  const structuralPattern = /\\(maketitle|frontmatter|tableofcontents|localtableofcontents|listoffigures|listoftables|listofchanges|mainmatter|appendix|printbibliography|printindex|backmatter)\b|\\(part|chapter)(\*)?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}|\\bibliography\s*\{([^{}]+)\}/g;
  let structuralMatch: RegExpExecArray | null;
  while ((structuralMatch = structuralPattern.exec(maskedSource)) !== null) {
    const command = structuralMatch[1] ?? structuralMatch[2] ?? "bibliography";
    structureCommands.push({
      ...rangeFromMatch(source, structuralMatch),
      command,
      kind: COMMAND_KIND[command],
      title: structuralMatch[4]?.trim() || COMMAND_TITLE[command] || command,
      starred: structuralMatch[3] === "*"
    });
  }
  structureCommands.sort((left, right) => left.start - right.start);

  const bibliographyResources: string[] = [];
  const bibliographyPattern = /\\(?:addbibresource|bibliography)\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g;
  let bibliographyMatch: RegExpExecArray | null;
  while ((bibliographyMatch = bibliographyPattern.exec(maskedSource)) !== null) {
    bibliographyResources.push(...splitLatexList(bibliographyMatch[1]));
  }

  const beginMatch = /\\begin\s*\{document\}/.exec(maskedSource);
  const endMatch = /\\end\s*\{document\}/.exec(maskedSource);

  return {
    source,
    maskedSource,
    magicEngine: magic.engine,
    magicRoot: magic.root,
    classDeclaration,
    packageDeclarations,
    includeDeclarations,
    structureCommands,
    bibliographyResources,
    hasDocumentBegin: Boolean(beginMatch),
    documentBegin: beginMatch ? rangeFromMatch(source, beginMatch) : undefined,
    documentEnd: endMatch ? rangeFromMatch(source, endMatch) : undefined,
    warnings
  };
}

function normalizedRelativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\0") || isAbsolute(value) || /^(?:[a-zA-Z]:|[\\/]{1,2})/.test(value)) return false;
  return !value.split(/[\\/]+/).some((segment) => segment === "..");
}

export function resolveProjectPath(projectRoot: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) throw new Error(`项目相对路径不安全: ${relativePath}`);
  const root = resolve(projectRoot);
  const target = resolve(root, relativePath);
  const foldedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const foldedTarget = process.platform === "win32" ? target.toLowerCase() : target;
  if (foldedTarget !== foldedRoot && !foldedTarget.startsWith(`${foldedRoot}${sep}`)) {
    throw new Error(`路径离开了项目根目录: ${relativePath}`);
  }
  return target;
}

export function resolveIncludedTexPath(projectRoot: string, entryDirectory: string, includePath: string): string | null {
  if (/\\|[{}#$%^&~]/.test(includePath)) return null;
  const withExtension = extname(includePath) ? includePath : `${includePath}.tex`;
  const candidateRelative = normalizedRelativePath(projectRoot, resolve(entryDirectory, withExtension));
  if (!isSafeRelativePath(candidateRelative)) return null;
  return resolveProjectPath(projectRoot, candidateRelative);
}

async function collectTexFiles(
  directory: string,
  depth: number,
  options: Required<ScanOptions>,
  output: string[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  const ignored = new Set(options.ignoredDirectories.map((name) => name.toLowerCase()));
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory()) {
        if (depth < options.maxDepth && !ignored.has(entry.name.toLowerCase())) {
          await collectTexFiles(fullPath, depth + 1, options, output);
        }
        return;
      }
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".tex") output.push(fullPath);
    })
  );
}

export async function scanLibrary(
  rootPath: string,
  partialOptions: Partial<ScanOptions> = {}
): Promise<ScanCandidate[]> {
  const root = resolve(rootPath);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`扫描根路径不是目录: ${root}`);

  const options: Required<ScanOptions> = {
    maxDepth: Math.max(0, Math.min(20, partialOptions.maxDepth ?? DEFAULT_SCAN_DEPTH)),
    ignoredDirectories: partialOptions.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES
  };
  const files: string[] = [];
  await collectTexFiles(root, 0, options, files);

  const groups = new Map<string, ScanCandidate["entries"]>();
  await Promise.all(
    files.map(async (filePath) => {
      try {
        const source = await readTextFile(filePath);
        const parsed = parseTexSource(source.content);
        if (!parsed.classDeclaration || !parsed.hasDocumentBegin) return;

        const projectRoot = dirname(filePath);
        const group = groups.get(projectRoot) ?? [];
        group.push({
          path: filePath,
          relativePath: normalizedRelativePath(projectRoot, filePath),
          engine: parsed.magicEngine,
          className: parsed.classDeclaration.name,
          classOptions: parsed.classDeclaration.options
        });
        groups.set(projectRoot, group);
      } catch (error) {
        if (error instanceof UnsupportedTextEncodingError) return;
        try {
          const fileStat = await lstat(filePath);
          if (!fileStat.isFile()) return;
        } catch {
          return;
        }
      }
    })
  );

  return [...groups.entries()]
    .map(([projectRoot, entries]) => ({
      rootPath: projectRoot,
      name: basename(projectRoot),
      entries: entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
    }))
    .sort((left, right) => left.rootPath.localeCompare(right.rootPath, "zh-CN"));
}

export const scanProjects = scanLibrary;
