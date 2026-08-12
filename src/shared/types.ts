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

export type ProjectLifecycle = "active" | "paused" | "completed" | "archived";
export type ProjectProtectionState = "unprotected" | "localBackup" | "github" | "both";

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
  /** A local-only project note. It is never written into the LaTeX project. */
  description?: string;
  /** Research lifecycle is independent from path/sync health. */
  lifecycle?: ProjectLifecycle;
  /** Cached protection summary; backups and GitHub remain separate mechanisms. */
  protectionState?: ProjectProtectionState;
}

export interface CatalogStatus {
  schemaVersion: number;
  persistent: boolean;
  databasePath: string;
  backupPath?: string;
  warnings: string[];
}

export interface ProjectCollection {
  id: string;
  name: string;
  color?: string;
  projectIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SmartViewFilter {
  query?: string;
  tags?: string[];
  favorite?: boolean;
  archived?: boolean;
  trashed?: boolean;
  pathAvailable?: boolean;
  openedWithinDays?: number;
}

export interface SmartView {
  id: string;
  name: string;
  filter: SmartViewFilter;
  createdAt: string;
  updatedAt: string;
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

export interface MobilePdfOutput {
  id: string;
  name: string;
  targetId: string;
  entry: string;
  profileId?: string;
  pdfPath: string;
  blobSha?: string;
  size?: number;
  generatedAt?: string;
}

export interface MobileProjectIndex {
  schemaVersion: 1 | 2 | 3;
  projectId: string;
  name: string;
  updatedAt: string;
  defaultOutputId?: string;
  outputs: MobilePdfOutput[];
  researchItems?: ProjectResearchItem[];
}

export interface MobilePdfCandidate {
  relativePath: string;
  size: number;
  modifiedAt: string;
  suggestedTargetIds: string[];
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
  | "queued"
  | "syncing"
  | "retrying"
  | "synced"
  | "needsPull"
  | "blocked"
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

export type SyncSecurityFindingKind = "secret" | "sensitiveFile" | "largeFile" | "researchCopyright";

export type SyncSecurityRecoveryAction =
  | "keepPrivate"
  | "createCleanPublicRepository"
  | "keepResearchLocalOnly"
  | "approveResearchUpload";

export interface SyncSecurityFinding {
  path: string;
  kind: SyncSecurityFindingKind;
  severity: "block" | "warning";
  message: string;
  /** Stable recovery actions that the UI can render without parsing a message. */
  recoveryActions?: SyncSecurityRecoveryAction[];
  /** Related managed paths, for example every attachment found in private Git history. */
  relatedPaths?: string[];
}

export interface GitHubSyncEvent {
  id: string;
  projectId: string;
  occurredAt: string;
  state: GitHubSyncState;
  level: "info" | "warning" | "error";
  message: string;
}

export interface GitHubSyncSettings {
  remoteUrl: string;
  autoSync: boolean;
  useLfsForDocuments: boolean;
}

export type GitHubRepositoryVisibility = "public" | "private";

export interface GitHubAccountStatus {
  cliAvailable: boolean;
  cliVersion?: string;
  authenticated: boolean;
  login?: string;
  name?: string;
  email?: string;
  message: string;
}

export interface GitHubCreateRepositoryOptions {
  repositoryName: string;
  visibility: GitHubRepositoryVisibility;
  autoSync: boolean;
  useLfsForDocuments: boolean;
}

export interface GitIdentity {
  name: string;
  email: string;
  configured: boolean;
  source: "local" | "global" | "none";
}

export interface GitHubSyncStatus extends GitHubSyncSettings {
  available: boolean;
  gitVersion?: string;
  configured: boolean;
  repository: boolean;
  lfsAvailable: boolean;
  branch?: string;
  repositoryFullName?: string;
  visibility?: GitHubRepositoryVisibility;
  state: GitHubSyncState;
  changedFiles: GitHubChangedFile[];
  largeFiles: GitHubLargeFile[];
  ahead: number;
  behind: number;
  lastSyncAt?: string;
  nextRetryAt?: string;
  paused?: boolean;
  securityFindings?: SyncSecurityFinding[];
  identity: GitIdentity;
  lastCommit?: {
    hash: string;
    message: string;
    committedAt: string;
  };
  message?: string;
}

export interface AppRuntimeSettings {
  closeToTray: boolean;
  onboardingCompleted: boolean;
  syncPaused: boolean;
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  glassMode: "auto" | "full" | "off";
}

export interface DesktopEnvironmentStatus {
  gitAvailable: boolean;
  gitVersion?: string;
  gitLfsAvailable: boolean;
  githubCliAvailable: boolean;
  githubCliVersion?: string;
}

export type AppUpdateState =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "downloaded"
  | "cancelled"
  | "unavailable"
  | "error";

export type AppUpdatePhase =
  | "idle"
  | "checkingRelease"
  | "verifyingManifest"
  | "preparingDownload"
  | "downloading"
  | "verifyingPackage"
  | "ready"
  | "cancelled"
  | "failed";

export interface AppUpdateSettings {
  autoCheck: boolean;
  autoDownload: boolean;
}

export interface AppUpdateStatus extends AppUpdateSettings {
  currentVersion: string;
  latestVersion?: string;
  state: AppUpdateState;
  githubCliAvailable: boolean;
  releaseUrl: string;
  releaseName?: string;
  publishedAt?: string;
  downloadedPath?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  progressPercent?: number;
  phase?: AppUpdatePhase;
  canCancel?: boolean;
  canRetry?: boolean;
  checkedAt?: string;
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

export type ResearchRole = "primarySource" | "reference" | "translationSource" | "data" | "supplement";
export interface ResearchWorkMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  isbn?: string;
  language?: string;
  canonicalUrl?: string;
}

/** A logical work in the local catalog. Its identity is not written into repositories. */
export interface ResearchWork extends ResearchWorkMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchAttachment {
  id: string;
  name: string;
  relativePath?: string;
  mediaType: string;
  size?: number;
  sha256?: string;
  gitBlobSha?: string;
  versionLabel?: string;
  availability: "repository" | "localOnly";
  /**
   * Explicit per-attachment copyright acknowledgement for publication.
   * Omitted/false is the safe default and blocks this attachment in public repositories.
   */
  publicUploadApproved?: boolean;
}

export interface ResearchTargetLink {
  /** null means that this material applies to the whole project. */
  targetId: string | null;
  role: ResearchRole;
  preferredAttachmentId?: string;
}

export interface ProjectResearchItem {
  id: string;
  title?: string;
  authors: string[];
  year?: number;
  language?: string;
  doi?: string;
  arxivId?: string;
  isbn?: string;
  attachments: ResearchAttachment[];
  links: ResearchTargetLink[];
  sortOrder?: number;
}

export interface CatalogProjectResearchItem {
  projectId: string;
  workId: string;
  item: ProjectResearchItem;
  createdAt: string;
  updatedAt: string;
  /** Local-only attachment paths keyed by attachment ID; never written to project metadata. */
  localAttachmentPaths: Record<string, string>;
}

export interface LegacyResearchCandidate {
  relativePath: string;
  name: string;
  size: number;
  modifiedAt: string;
  mediaType: string;
  sha256: string;
  duplicateItemIds: string[];
  pendingTargetAssignment: true;
}

export interface ResearchSaveRequest {
  items: ProjectResearchItem[];
  localAttachmentPaths?: Record<string, string>;
  /** Attachment IDs explicitly approved by the user in this exact save action. */
  publicUploadApprovalIds?: string[];
}

export type ResearchSearchKind = "project" | "file" | "heading" | "label" | "citation" | "bib" | "research";

export interface ResearchSearchHit {
  id: string;
  projectId: string;
  kind: ResearchSearchKind;
  title: string;
  detail?: string;
  relativePath?: string;
  line?: number;
  score: number;
}

export interface ProjectSearchIndexStatus {
  projectId: string;
  indexedFiles: number;
  skippedFiles: number;
  removedFiles: number;
  indexedAt: string;
}

export interface CatalogBackupInfo {
  path: string;
  createdAt: string;
  size: number;
  kind: "automatic" | "manual" | "preMigration";
}

export interface CatalogRestoreResult {
  backup: CatalogBackupInfo;
  restartRequired: true;
}

export type ProjectBackupFrequency = "off" | "daily" | "weekly";

export interface ProjectBackupSettings {
  projectId: string;
  frequency: ProjectBackupFrequency;
  retainCount: number;
  updatedAt: string;
}

export interface ProjectBackupPreview {
  projectId: string;
  fileCount: number;
  totalBytes: number;
  localOnlyAttachmentCount: number;
  excludedPaths: string[];
}

export interface BackupSnapshot {
  id: string;
  projectId: string;
  projectName: string;
  path: string;
  createdAt: string;
  size: number;
  fileCount: number;
  kind: "manual" | "scheduled" | "preMigration";
  verified: boolean;
  verifiedAt?: string;
}

export interface BackupVerification {
  snapshotId: string;
  valid: boolean;
  checkedFiles: number;
  errors: string[];
}

export interface BackupRestoreResult {
  snapshotId: string;
  destinationPath: string;
  restoredFiles: number;
  restoredLocalAttachments?: number;
  researchRecoveryPath?: string;
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
  source?: "configured" | "path" | "common";
  diagnostics?: string[];
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

export type ProjectFileKind =
  | "directory"
  | "tex"
  | "bib"
  | "pdf"
  | "image"
  | "archive"
  | "document"
  | "other";

export interface ProjectFileEntry {
  name: string;
  relativePath: string;
  kind: ProjectFileKind;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  extension?: string;
  hidden: boolean;
  hash?: string;
}

export interface ProjectFileListOptions {
  directory?: string;
  query?: string;
  recursive?: boolean;
  includeHidden?: boolean;
  sort?: "name" | "modified" | "size" | "type";
  direction?: "asc" | "desc";
}

export type ProjectFileOperationKind = "rename" | "move" | "copy" | "trash";

export interface ProjectFileOperationRequest {
  kind: ProjectFileOperationKind;
  sourcePath: string;
  destinationPath?: string;
  expectedHash?: string;
  rewriteLatexReferences?: boolean;
}

export interface LatexReferenceChange {
  filePath: string;
  expectedHash: string;
  occurrences: number;
  oldReference: string;
  newReference: string;
}

export interface ProjectFileOperationPlan {
  id: string;
  kind: ProjectFileOperationKind;
  sourcePath: string;
  destinationPath?: string;
  sourceHash: string;
  sourceSize: number;
  isDirectory: boolean;
  referenceChanges: LatexReferenceChange[];
  warnings: string[];
  createdAt: string;
  expiresAt: string;
}

export interface ProjectFileOperationResult {
  undoId: string;
  affectedPaths: string[];
  rewrittenFiles: string[];
  operation: ProjectFileOperationKind;
  sourcePath: string;
  destinationPath?: string;
  undoExpiresAt: string;
}

export interface ProjectFileUndoResult {
  restoredPaths: string[];
  revertedReferenceFiles: string[];
}

export interface ProjectFileOperationHistoryEntry {
  id: string;
  projectId: string;
  operation: ProjectFileOperationKind;
  sourcePath: string;
  destinationPath?: string;
  createdAt: string;
  undoExpiresAt?: string;
  result: "applied" | "undone";
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
  source: "builtin" | "user";
  category: "article" | "book" | "presentation" | "other";
  createdAt: string;
  fileCount: number;
  totalBytes: number;
  className?: string;
  assetPins: AssetPin[];
}

export interface TemplateCreateOptions {
  name: string;
  description?: string;
  category?: TemplateInfo["category"];
}
