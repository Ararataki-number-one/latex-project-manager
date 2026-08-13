import type {
  AppUpdateSettings,
  AppUpdateStatus,
  AppRuntimeSettings,
  CatalogStatus,
  CatalogBackupInfo,
  BackupRestoreResult,
  BackupSnapshot,
  BackupVerification,
  CatalogProjectResearchItem,
  CatalogRestoreResult,
  DesktopEnvironmentStatus,
  DesktopMigrationApplyOptions,
  DesktopMigrationPreview,
  DesktopMigrationResult,
  ExportResult,
  GitIdentity,
  GitHubAccountStatus,
  GitHubCreateRepositoryOptions,
  GitHubRepositoryVisibility,
  GitHubSyncEvent,
  GitHubSyncSettings,
  GitHubSyncStatus,
  MigrationPreview,
  MobilePdfCandidate,
  MobileProjectIndex,
  OperationSnapshot,
  ProjectManifest,
  ProjectCollection,
  ProjectBackupPreview,
  ProjectBackupSettings,
  ProjectFileEntry,
  ProjectFileListOptions,
  ProjectFileOperationPlan,
  ProjectFileOperationRequest,
  ProjectFileOperationResult,
  ProjectFileOperationHistoryEntry,
  ProjectFileUndoResult,
  ProjectPdfInfo,
  ProjectStorageInfo,
  ProjectSearchIndexStatus,
  ProjectSummary,
  ProjectStatusChangedEvent,
  ProjectStatusRecord,
  ReferenceDocumentInfo,
  LegacyResearchCandidate,
  ResearchSaveRequest,
  ResearchSearchHit,
  ScanCandidate,
  ScanOptions,
  TemplateCreateOptions,
  TemplateInfo,
  TemporaryCleanupPreview,
  TemporaryCleanupResult,
  ToolchainInfo,
  VsCodeStatus,
  SyncSecurityFinding,
  SmartView
} from "./types";

export const IPC = {
  libraryList: "library:list",
  libraryScan: "library:scan",
  libraryImport: "library:import",
  libraryImportMany: "library:import-many",
  libraryCatalogStatus: "library:catalog-status",
  libraryRelink: "library:relink",
  libraryUpdate: "library:update",
  libraryOpenFolder: "library:open-folder",
  libraryOpenInVsCode: "library:open-in-vscode",
  libraryCopy: "library:copy",
  libraryExportZip: "library:export-zip",
  libraryLastSuccessfulPdf: "library:last-successful-pdf",
  libraryOpenLastSuccessfulPdf: "library:open-last-successful-pdf",
  libraryExportLastSuccessfulPdf: "library:export-last-successful-pdf",
  libraryCleanupPreview: "library:cleanup-preview",
  libraryCleanupApply: "library:cleanup-apply",
  libraryStorageInfo: "library:storage-info",
  projectStatusList: "project-status:list",
  projectStatusGet: "project-status:get",
  projectStatusRefresh: "project-status:refresh",
  projectStatusEvent: "project-status:event",
  operationsList: "operations:list",
  operationsCancel: "operations:cancel",
  operationsRetry: "operations:retry",
  operationsEvent: "operations:event",
  desktopMigrationPreview: "desktop-migration:preview",
  desktopMigrationApply: "desktop-migration:apply",
  catalogBackupsList: "catalog-backups:list",
  catalogBackupsCreate: "catalog-backups:create",
  catalogBackupsStageRestore: "catalog-backups:stage-restore",
  projectBackupsPreview: "project-backups:preview",
  projectBackupsCreate: "project-backups:create",
  projectBackupsList: "project-backups:list",
  projectBackupsVerify: "project-backups:verify",
  projectBackupsRestore: "project-backups:restore",
  projectBackupsSettings: "project-backups:settings",
  projectBackupsSetSettings: "project-backups:set-settings",
  collectionsList: "collections:list",
  collectionsCreate: "collections:create",
  collectionsUpdate: "collections:update",
  collectionsDelete: "collections:delete",
  smartViewsList: "smart-views:list",
  smartViewsCreate: "smart-views:create",
  smartViewsUpdate: "smart-views:update",
  smartViewsDelete: "smart-views:delete",
  mobileIndexRead: "mobile-index:read",
  mobileIndexCandidates: "mobile-index:candidates",
  mobileIndexWrite: "mobile-index:write",
  githubStatus: "github:status",
  githubConfigure: "github:configure",
  githubSyncNow: "github:sync-now",
  githubSetAutoSync: "github:set-auto-sync",
  githubSetIdentity: "github:set-identity",
  githubAuthStatus: "github:auth-status",
  githubBeginLogin: "github:begin-login",
  githubCreateRepository: "github:create-repository",
  githubSetVisibility: "github:set-visibility",
  githubOpenRemote: "github:open-remote",
  githubOpenProductPage: "github:open-product-page",
  githubOpenCliDownload: "github:open-cli-download",
  githubSecurityPreflight: "github:security-preflight",
  githubAcknowledgeWarnings: "github:acknowledge-warnings",
  githubHistory: "github:history",
  githubSyncAll: "github:sync-all",
  githubPauseAll: "github:pause-all",
  githubResumeAll: "github:resume-all",
  githubEvent: "github:event",
  runtimeSettings: "runtime:settings",
  runtimeSetSettings: "runtime:set-settings",
  runtimeEnvironmentStatus: "runtime:environment-status",
  updatesStatus: "updates:status",
  updatesSetSettings: "updates:set-settings",
  updatesCheck: "updates:check",
  updatesDownload: "updates:download",
  updatesCancel: "updates:cancel",
  updatesInstall: "updates:install",
  updatesOpenRelease: "updates:open-release",
  updatesEvent: "updates:event",
  referencesList: "references:list",
  referencesImport: "references:import",
  referencesOpen: "references:open",
  referencesOpenFolder: "references:open-folder",
  referencesRemove: "references:remove",
  researchList: "research:list",
  researchListGlobal: "research:list-global",
  researchDiscoverLegacy: "research:discover-legacy",
  researchSave: "research:save",
  researchOpenAttachment: "research:open-attachment",
  researchSearchIndex: "research-search:index",
  researchSearchIndexAll: "research-search:index-all",
  researchSearchQuery: "research-search:query",
  manifestRead: "manifest:read",
  manifestWrite: "manifest:write",
  migrationPreview: "migration:preview",
  migrationApply: "migration:apply",
  migrationRollback: "migration:rollback",
  buildStart: "build:start",
  buildCancel: "build:cancel",
  buildStatus: "build:status",
  buildEvent: "build:event",
  syncForward: "synctex:forward",
  syncBackward: "synctex:backward",
  fileRead: "file:read",
  fileWrite: "file:write",
  fileRename: "file:rename",
  fileMove: "file:move",
  fileTrash: "file:trash",
  fileDelete: "file:delete",
  fileList: "file:list",
  fileCreateDirectory: "file:create-directory",
  fileCreate: "file:create",
  fileImport: "file:import",
  filePlan: "file:plan",
  fileApply: "file:apply",
  fileUndo: "file:undo",
  fileHistory: "file:history",
  fileOpen: "file:open",
  fileReveal: "file:reveal",
  templatesList: "templates:list",
  templatesCreate: "templates:create",
  templatesCreateFromProject: "templates:create-from-project",
  templatesDelete: "templates:delete",
  templatesInstantiate: "templates:instantiate",
  toolchainsList: "toolchains:list",
  vscodeStatus: "vscode:status",
  vscodeOpenProject: "vscode:open-project",
  vscodeOpenFile: "vscode:open-file",
  vscodeOpenProfile: "vscode:open-profile",
  editorStatus: "editor:status",
  editorSelectExecutable: "editor:select-executable",
  editorResetExecutable: "editor:reset-executable",
  editorOpenProject: "editor:open-project",
  editorOpenFile: "editor:open-file",
  dialogOpenDirectory: "dialog:open-directory",
  dialogOpenFile: "dialog:open-file",
  editorOpenExternal: "editor:open-external"
} as const;

export interface WorkbenchApi {
  library: {
    list(): Promise<ProjectSummary[]>;
    scan(rootPath: string, options?: Partial<ScanOptions>): Promise<ScanCandidate[]>;
    import(candidate: ScanCandidate): Promise<ProjectSummary>;
    importMany(candidates: ScanCandidate[]): Promise<ProjectSummary[]>;
    catalogStatus(): Promise<CatalogStatus>;
    relink(projectId: string, rootPath: string): Promise<ProjectSummary>;
    update(projectId: string, patch: Partial<Pick<ProjectSummary, "name" | "description" | "favorite" | "archived" | "trashed" | "tags" | "lifecycle" | "protectionState">>): Promise<ProjectSummary>;
    openFolder(projectId: string): Promise<void>;
    openInVsCode(projectId: string): Promise<void>;
    copy(projectId: string, destinationParent: string, name: string): Promise<ProjectSummary>;
    exportZip(projectId: string): Promise<ExportResult>;
    lastSuccessfulPdf(projectId: string): Promise<ProjectPdfInfo | null>;
    openLastSuccessfulPdf(projectId: string): Promise<void>;
    exportLastSuccessfulPdf(projectId: string): Promise<ExportResult>;
    previewTemporaryCleanup(projectId: string): Promise<TemporaryCleanupPreview>;
    applyTemporaryCleanup(projectId: string, planId: string): Promise<TemporaryCleanupResult>;
    storageInfo(projectId: string): Promise<ProjectStorageInfo>;
  };
  collections: {
    list(): Promise<ProjectCollection[]>;
    create(input: Pick<ProjectCollection, "name" | "color" | "projectIds">): Promise<ProjectCollection>;
    update(id: string, patch: Partial<Pick<ProjectCollection, "name" | "color" | "projectIds">>): Promise<ProjectCollection>;
    delete(id: string): Promise<void>;
  };
  projectStatus: {
    list(): Promise<ProjectStatusRecord[]>;
    get(projectId: string): Promise<ProjectStatusRecord | null>;
    refresh(projectId: string): Promise<ProjectStatusRecord>;
    onEvent(listener: (event: ProjectStatusChangedEvent) => void): () => void;
  };
  operations: {
    list(projectId?: string, limit?: number): Promise<OperationSnapshot[]>;
    cancel(operationId: string): Promise<OperationSnapshot>;
    retry(operationId: string): Promise<OperationSnapshot>;
    onEvent(listener: (snapshot: OperationSnapshot) => void): () => void;
  };
  desktopMigration: {
    preview(): Promise<DesktopMigrationPreview | null>;
    apply(previewId: string, options: DesktopMigrationApplyOptions): Promise<DesktopMigrationResult>;
  };
  catalogBackups: {
    list(): Promise<CatalogBackupInfo[]>;
    create(): Promise<CatalogBackupInfo | null>;
    stageRestore(): Promise<CatalogRestoreResult | null>;
  };
  projectBackups: {
    preview(projectId: string): Promise<ProjectBackupPreview>;
    create(projectId: string): Promise<BackupSnapshot>;
    list(projectId: string): Promise<BackupSnapshot[]>;
    verify(projectId: string, snapshotId: string): Promise<BackupVerification>;
    restore(projectId: string, snapshotId: string): Promise<BackupRestoreResult | null>;
    settings(projectId: string): Promise<ProjectBackupSettings>;
    setSettings(projectId: string, settings: Pick<ProjectBackupSettings, "frequency" | "retainCount">): Promise<ProjectBackupSettings>;
  };
  smartViews: {
    list(): Promise<SmartView[]>;
    create(input: Pick<SmartView, "name" | "filter">): Promise<SmartView>;
    update(id: string, patch: Partial<Pick<SmartView, "name" | "filter">>): Promise<SmartView>;
    delete(id: string): Promise<void>;
  };
  mobileIndex: {
    read(projectId: string): Promise<MobileProjectIndex | null>;
    candidates(projectId: string): Promise<MobilePdfCandidate[]>;
    write(projectId: string, index: MobileProjectIndex): Promise<MobileProjectIndex>;
  };
  github: {
    status(projectId: string): Promise<GitHubSyncStatus>;
    configure(projectId: string, settings: GitHubSyncSettings): Promise<GitHubSyncStatus>;
    syncNow(projectId: string): Promise<GitHubSyncStatus>;
    setAutoSync(projectId: string, enabled: boolean): Promise<GitHubSyncStatus>;
    setIdentity(projectId: string, identity: Pick<GitIdentity, "name" | "email">): Promise<GitHubSyncStatus>;
    authStatus(): Promise<GitHubAccountStatus>;
    beginLogin(): Promise<GitHubAccountStatus>;
    createRepository(projectId: string, options: GitHubCreateRepositoryOptions): Promise<GitHubSyncStatus>;
    setVisibility(projectId: string, visibility: GitHubRepositoryVisibility): Promise<GitHubSyncStatus>;
    openRemote(projectId: string): Promise<void>;
    openProductPage(): Promise<void>;
    openCliDownload(): Promise<void>;
    securityPreflight(projectId: string, includeTracked?: boolean): Promise<SyncSecurityFinding[]>;
    acknowledgeWarnings(projectId: string, paths: string[]): Promise<GitHubSyncStatus>;
    history(projectId: string, limit?: number): Promise<GitHubSyncEvent[]>;
    syncAll(): Promise<GitHubSyncStatus[]>;
    pauseAll(): Promise<void>;
    resumeAll(): Promise<void>;
    onEvent(listener: (event: GitHubSyncEvent) => void): () => void;
  };
  runtime: {
    settings(): Promise<AppRuntimeSettings>;
    setSettings(settings: AppRuntimeSettings): Promise<AppRuntimeSettings>;
    environmentStatus(): Promise<DesktopEnvironmentStatus>;
  };
  updates: {
    status(): Promise<AppUpdateStatus>;
    setSettings(settings: AppUpdateSettings): Promise<AppUpdateStatus>;
    check(): Promise<AppUpdateStatus>;
    download(): Promise<AppUpdateStatus>;
    cancel(): Promise<AppUpdateStatus>;
    install(): Promise<void>;
    openRelease(): Promise<void>;
    onEvent(listener: (status: AppUpdateStatus) => void): () => void;
  };
  references: {
    list(projectId: string): Promise<ReferenceDocumentInfo[]>;
    import(projectId: string): Promise<ReferenceDocumentInfo[]>;
    open(projectId: string, relativePath: string): Promise<void>;
    openFolder(projectId: string): Promise<void>;
    remove(projectId: string, relativePath: string): Promise<ReferenceDocumentInfo[]>;
  };
  research: {
    list(projectId: string): Promise<CatalogProjectResearchItem[]>;
    listGlobal(): Promise<CatalogProjectResearchItem[]>;
    discoverLegacy(projectId: string): Promise<LegacyResearchCandidate[]>;
    save(projectId: string, request: ResearchSaveRequest): Promise<CatalogProjectResearchItem[]>;
    openAttachment(projectId: string, itemId: string, attachmentId: string): Promise<void>;
  };
  researchSearch: {
    index(projectId: string): Promise<ProjectSearchIndexStatus>;
    indexAll(): Promise<ProjectSearchIndexStatus[]>;
    query(query: string, projectIds?: string[], limit?: number): Promise<ResearchSearchHit[]>;
  };
  manifest: {
    read(projectRoot: string): Promise<ProjectManifest>;
    write(projectRoot: string, manifest: ProjectManifest): Promise<ProjectManifest>;
  };
  migration: {
    preview(projectRoot: string, entryPath: string): Promise<MigrationPreview>;
  };
  files: {
    list(projectId: string, options?: ProjectFileListOptions): Promise<ProjectFileEntry[]>;
    createDirectory(projectId: string, parentPath: string, name: string): Promise<ProjectFileEntry>;
    create(projectId: string, parentPath: string, name: string): Promise<ProjectFileEntry>;
    import(projectId: string, destinationDirectory?: string): Promise<ProjectFileEntry[]>;
    plan(projectId: string, request: ProjectFileOperationRequest): Promise<ProjectFileOperationPlan>;
    apply(projectId: string, planId: string): Promise<ProjectFileOperationResult>;
    undo(projectId: string, undoId: string): Promise<ProjectFileUndoResult>;
    history(projectId: string, limit?: number): Promise<ProjectFileOperationHistoryEntry[]>;
    open(projectId: string, path: string): Promise<void>;
    reveal(projectId: string, path: string): Promise<void>;
    rename(projectId: string, fromPath: string, toPath: string, expectedHash?: string): Promise<void>;
    move(projectId: string, fromPath: string, toPath: string, expectedHash?: string): Promise<void>;
    trash(projectId: string, path: string): Promise<void>;
    delete(projectId: string, path: string): Promise<void>;
  };
  templates: {
    list(): Promise<TemplateInfo[]>;
    create(sourceRoot: string, name: string): Promise<TemplateInfo>;
    createFromProject(projectId: string, options: TemplateCreateOptions): Promise<TemplateInfo>;
    delete(templateId: string): Promise<void>;
    instantiate(templateId: string, parentRoot: string, name: string): Promise<string>;
  };
  toolchains: {
    list(): Promise<ToolchainInfo[]>;
  };
  vscode: {
    status(): Promise<VsCodeStatus>;
    openProject(projectRoot: string): Promise<void>;
    openFile(projectRoot: string, relativePath: string, line?: number): Promise<void>;
    openProfile(projectRoot: string, targetId: string, profileId: string): Promise<string>;
  };
  editor: {
    status(): Promise<VsCodeStatus>;
    selectExecutable(): Promise<VsCodeStatus | null>;
    resetExecutable(): Promise<VsCodeStatus>;
    openProject(projectId: string): Promise<void>;
    openFile(projectId: string, relativePath: string, line?: number, column?: number): Promise<void>;
    openExternal(path: string, line?: number): Promise<void>;
  };
  dialogs: {
    openDirectory(): Promise<string | null>;
    openFile(filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null>;
  };
}

declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}
