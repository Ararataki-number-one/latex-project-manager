import type {
  AppUpdateSettings,
  AppUpdateStatus,
  AppRuntimeSettings,
  CatalogStatus,
  DesktopEnvironmentStatus,
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
  ProjectManifest,
  ProjectCollection,
  ProjectFileEntry,
  ProjectFileListOptions,
  ProjectFileOperationPlan,
  ProjectFileOperationRequest,
  ProjectFileOperationResult,
  ProjectFileUndoResult,
  ProjectPdfInfo,
  ProjectStorageInfo,
  ProjectSummary,
  ReferenceDocumentInfo,
  ScanCandidate,
  ScanOptions,
  TemplateInfo,
  TemporaryCleanupPreview,
  TemporaryCleanupResult,
  ToolchainInfo,
  VsCodeStatus,
  SyncSecurityFinding
  ,SmartView
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
  updatesInstall: "updates:install",
  updatesOpenRelease: "updates:open-release",
  referencesList: "references:list",
  referencesImport: "references:import",
  referencesOpen: "references:open",
  referencesOpenFolder: "references:open-folder",
  referencesRemove: "references:remove",
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
  fileOpen: "file:open",
  fileReveal: "file:reveal",
  templatesList: "templates:list",
  templatesCreate: "templates:create",
  templatesInstantiate: "templates:instantiate",
  toolchainsList: "toolchains:list",
  vscodeStatus: "vscode:status",
  vscodeOpenProject: "vscode:open-project",
  vscodeOpenFile: "vscode:open-file",
  vscodeOpenProfile: "vscode:open-profile",
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
    update(projectId: string, patch: Partial<Pick<ProjectSummary, "name" | "description" | "favorite" | "archived" | "trashed" | "tags">>): Promise<ProjectSummary>;
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
    install(): Promise<void>;
    openRelease(): Promise<void>;
  };
  references: {
    list(projectId: string): Promise<ReferenceDocumentInfo[]>;
    import(projectId: string): Promise<ReferenceDocumentInfo[]>;
    open(projectId: string, relativePath: string): Promise<void>;
    openFolder(projectId: string): Promise<void>;
    remove(projectId: string, relativePath: string): Promise<ReferenceDocumentInfo[]>;
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
  dialogs: {
    openDirectory(): Promise<string | null>;
    openFile(filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null>;
  };
  editor: {
    openExternal(path: string, line?: number): Promise<void>;
  };
}

declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}
