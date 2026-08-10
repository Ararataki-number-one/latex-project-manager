export type Engine = "auto" | "xelatex" | "lualatex" | "pdflatex";
export type ChapterState = "full" | "titleOnly" | "hidden";
export type NumberingMode = "preserve" | "continuous";
export type StructureKind =
  | "cover"
  | "title"
  | "frontmatter"
  | "toc"
  | "localToc"
  | "listOfFigures"
  | "listOfTables"
  | "listOfChanges"
  | "mainmatter"
  | "part"
  | "chapter"
  | "input"
  | "appendix"
  | "bibliography"
  | "index"
  | "backmatter"
  | "raw";

export interface ClassConfig {
  name: string;
  options: Record<string, string | boolean>;
  rawOptions: string[];
  source?: "project" | "texlive" | "unknown";
  sourcePath?: string;
  sourceHash?: string;
}

export interface PackageSpec {
  id: string;
  name: string;
  options: string[];
  enabled: boolean;
  order: number;
  source: "managed" | "manual" | "class";
  condition?: string;
  diagnostic?: "ok" | "missing" | "duplicate" | "conflict";
}

export interface StructureNode {
  id: string;
  kind: StructureKind;
  title: string;
  path?: string;
  phase: "frontmatter" | "mainmatter" | "appendix" | "backmatter";
  order: number;
  originalNumber?: number;
  titleSource?: "main" | "file" | "manual" | "dynamic";
  headingSource?: string;
  contentSource?: string;
  managed: boolean;
}

export interface BuildProfile {
  id: string;
  name: string;
  chapterState: Record<string, ChapterState>;
  numbering: NumberingMode;
  enabledBlocks: Record<string, boolean>;
  order: string[];
  focusNodes?: string[];
  autoCompile?: boolean;
}

export interface DocumentTarget {
  id: string;
  name: string;
  entry: string;
  engine: Engine;
  texDistribution?: string;
  classConfig: ClassConfig;
  packages: PackageSpec[];
  structure: StructureNode[];
  profiles: BuildProfile[];
}

export interface AssetPin {
  id: string;
  kind: "class" | "font" | "template" | "other";
  path: string;
  hash: string;
  source?: string;
}

export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  targets: DocumentTarget[];
  assets: AssetPin[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  targetCount: number;
  classNames: string[];
  lastOpenedAt?: string;
  lastBuildAt?: string;
  lastBuildStatus?: BuildStatus;
  favorite: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt?: string;
  tags: string[];
  thumbnailPath?: string;
  pathAvailable: boolean;
}

export interface ExportResult {
  canceled: boolean;
  path?: string;
}

export interface ProjectPdfInfo {
  path: string;
  size: number;
  modifiedAt: string;
  targetId?: string;
  profileId?: string;
}

export interface TemporaryCleanupPreview {
  planId: string;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  samplePaths: string[];
  categories: Array<{ name: string; count: number }>;
  expiresAt: string;
}

export interface TemporaryCleanupResult {
  fileCount: number;
  directoryCount: number;
  freedBytes: number;
}

export interface ProjectStorageInfo {
  totalBytes: number;
  fileCount: number;
  measuredAt: string;
}

export type GitHubSyncState =
  | "unavailable"
  | "notConfigured"
  | "ready"
  | "changes"
  | "syncing"
  | "synced"
  | "needsPull"
  | "error";

export interface GitHubChangedFile {
  path: string;
  status: string;
}

export interface GitHubLargeFile {
  path: string;
  size: number;
  trackedByLfs: boolean;
}

export interface GitHubSyncSettings {
  remoteUrl: string;
  autoSync: boolean;
  useLfsForDocuments: boolean;
}

export interface GitHubSyncStatus extends GitHubSyncSettings {
  available: boolean;
  gitVersion?: string;
  configured: boolean;
  repository: boolean;
  lfsAvailable: boolean;
  branch?: string;
  state: GitHubSyncState;
  changedFiles: GitHubChangedFile[];
  largeFiles: GitHubLargeFile[];
  ahead: number;
  behind: number;
  lastSyncAt?: string;
  lastCommit?: {
    hash: string;
    message: string;
    committedAt: string;
  };
  message?: string;
}

export type ReferenceDocumentKind = "pdf" | "ebook" | "document" | "archive" | "other";

export interface ReferenceDocumentInfo {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  kind: ReferenceDocumentKind;
  lfsRecommended: boolean;
}

export interface ScanCandidate {
  rootPath: string;
  name: string;
  entries: Array<{
    path: string;
    relativePath: string;
    engine: Engine;
    className: string;
    classOptions: string[];
  }>;
}

export interface ScanOptions {
  maxDepth: number;
  ignoredDirectories?: string[];
}

export interface MigrationChange {
  id: string;
  section: "class" | "packages" | "structure" | "manifest";
  label: string;
  before: string;
  after: string;
  selected: boolean;
  confidence: "high" | "medium" | "manual";
}

export interface MigrationPreview {
  projectRoot: string;
  entryPath: string;
  sourceHash: string;
  manifest: ProjectManifest;
  changes: MigrationChange[];
  warnings: string[];
}

export type BuildStatus = "idle" | "queued" | "running" | "success" | "warning" | "failed" | "cancelled";

export interface BuildProblem {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  column?: number;
  message: string;
  raw?: string;
}

export interface BuildRequest {
  projectRoot: string;
  targetId: string;
  profileId: string;
  saveDirtyFiles?: boolean;
  focusNodes?: string[];
  shellEscape?: boolean;
}

export interface BuildEvent {
  buildId: string;
  projectRoot: string;
  status: BuildStatus;
  targetId: string;
  profileId: string;
  startedAt?: string;
  finishedAt?: string;
  logChunk?: string;
  problems?: BuildProblem[];
  pdfPath?: string;
  synctexPath?: string;
  stalePdf?: boolean;
}

export interface ToolchainInfo {
  name: "texlive" | "miktex" | "unknown";
  version?: string;
  binPath: string;
  latexmk?: string;
  xelatex?: string;
  lualatex?: string;
  pdflatex?: string;
  biber?: string;
  bibtex?: string;
  synctex?: string;
  kpsewhich?: string;
}

export type VsCodeEditor = "code" | "codium";

export interface VsCodeStatus {
  available: boolean;
  editor?: VsCodeEditor;
  executablePath?: string;
  source?: "path" | "common";
  latexWorkshop: {
    state: "installed" | "notFound" | "unknown";
    version?: string;
  };
}

export interface FileReadResult {
  path: string;
  content: string;
  hash: string;
  encoding: "utf8" | "utf8-bom";
  lineEnding: "lf" | "crlf";
  mtimeMs: number;
}

export interface FileWriteRequest {
  projectRoot: string;
  path: string;
  content: string;
  expectedHash: string;
}

export interface SyncTexLocation {
  file: string;
  line: number;
  column?: number;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  rootPath: string;
  className?: string;
  assetPins: AssetPin[];
}
