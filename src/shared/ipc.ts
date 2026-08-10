import type {
  ExportResult,
  GitHubSyncSettings,
  GitHubSyncStatus,
  MigrationPreview,
  ProjectManifest,
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
  VsCodeStatus
} from "./types";

export const IPC = {
  libraryList: "library:list",
  libraryScan: "library:scan",
  libraryImport: "library:import",
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
  githubStatus: "github:status",
  githubConfigure: "github:configure",
  githubSyncNow: "github:sync-now",
  githubSetAutoSync: "github:set-auto-sync",
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
    relink(projectId: string, rootPath: string): Promise<ProjectSummary>;
    update(projectId: string, patch: Partial<Pick<ProjectSummary, "name" | "favorite" | "archived" | "trashed" | "tags">>): Promise<ProjectSummary>;
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
  github: {
    status(projectId: string): Promise<GitHubSyncStatus>;
    configure(projectId: string, settings: GitHubSyncSettings): Promise<GitHubSyncStatus>;
    syncNow(projectId: string): Promise<GitHubSyncStatus>;
    setAutoSync(projectId: string, enabled: boolean): Promise<GitHubSyncStatus>;
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
    rename(projectRoot: string, fromPath: string, toPath: string, expectedHash?: string): Promise<void>;
    move(projectRoot: string, fromPath: string, toPath: string, expectedHash?: string): Promise<void>;
    trash(projectRoot: string, path: string): Promise<void>;
    delete(projectRoot: string, path: string): Promise<void>;
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
