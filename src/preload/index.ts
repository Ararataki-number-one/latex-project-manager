import { contextBridge, ipcRenderer } from "electron";
import { IPC, type WorkbenchApi } from "../shared/ipc";

const api: WorkbenchApi = {
  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    scan: (rootPath, options) => ipcRenderer.invoke(IPC.libraryScan, rootPath, options),
    import: (candidate) => ipcRenderer.invoke(IPC.libraryImport, candidate),
    importMany: (candidates) => ipcRenderer.invoke(IPC.libraryImportMany, candidates),
    catalogStatus: () => ipcRenderer.invoke(IPC.libraryCatalogStatus),
    relink: (projectId, rootPath) => ipcRenderer.invoke(IPC.libraryRelink, projectId, rootPath),
    update: (projectId, patch) => ipcRenderer.invoke(IPC.libraryUpdate, projectId, patch),
    openFolder: (projectId) => ipcRenderer.invoke(IPC.libraryOpenFolder, projectId),
    openInVsCode: (projectId) => ipcRenderer.invoke(IPC.libraryOpenInVsCode, projectId),
    copy: (projectId, destinationParent, name) =>
      ipcRenderer.invoke(IPC.libraryCopy, projectId, destinationParent, name),
    exportZip: (projectId) => ipcRenderer.invoke(IPC.libraryExportZip, projectId),
    lastSuccessfulPdf: (projectId) => ipcRenderer.invoke(IPC.libraryLastSuccessfulPdf, projectId),
    openLastSuccessfulPdf: (projectId) => ipcRenderer.invoke(IPC.libraryOpenLastSuccessfulPdf, projectId),
    exportLastSuccessfulPdf: (projectId) => ipcRenderer.invoke(IPC.libraryExportLastSuccessfulPdf, projectId),
    previewTemporaryCleanup: (projectId) => ipcRenderer.invoke(IPC.libraryCleanupPreview, projectId),
    applyTemporaryCleanup: (projectId, planId) => ipcRenderer.invoke(IPC.libraryCleanupApply, projectId, planId),
    storageInfo: (projectId) => ipcRenderer.invoke(IPC.libraryStorageInfo, projectId)
  },
  projectStatus: {
    list: () => ipcRenderer.invoke(IPC.projectStatusList),
    get: (projectId) => ipcRenderer.invoke(IPC.projectStatusGet, projectId),
    refresh: (projectId) => ipcRenderer.invoke(IPC.projectStatusRefresh, projectId),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on(IPC.projectStatusEvent, handler);
      return () => ipcRenderer.removeListener(IPC.projectStatusEvent, handler);
    }
  },
  operations: {
    list: (projectId, limit) => ipcRenderer.invoke(IPC.operationsList, projectId, limit),
    cancel: (operationId) => ipcRenderer.invoke(IPC.operationsCancel, operationId),
    retry: (operationId) => ipcRenderer.invoke(IPC.operationsRetry, operationId),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on(IPC.operationsEvent, handler);
      return () => ipcRenderer.removeListener(IPC.operationsEvent, handler);
    }
  },
  desktopMigration: {
    preview: () => ipcRenderer.invoke(IPC.desktopMigrationPreview),
    apply: (previewId, options) => ipcRenderer.invoke(IPC.desktopMigrationApply, previewId, options)
  },
  collections: {
    list: () => ipcRenderer.invoke(IPC.collectionsList),
    create: (input) => ipcRenderer.invoke(IPC.collectionsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.collectionsUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.collectionsDelete, id)
  },
  catalogBackups: {
    list: () => ipcRenderer.invoke(IPC.catalogBackupsList),
    create: () => ipcRenderer.invoke(IPC.catalogBackupsCreate),
    stageRestore: () => ipcRenderer.invoke(IPC.catalogBackupsStageRestore)
  },
  projectBackups: {
    preview: (projectId) => ipcRenderer.invoke(IPC.projectBackupsPreview, projectId),
    create: (projectId) => ipcRenderer.invoke(IPC.projectBackupsCreate, projectId),
    list: (projectId) => ipcRenderer.invoke(IPC.projectBackupsList, projectId),
    verify: (projectId, snapshotId) => ipcRenderer.invoke(IPC.projectBackupsVerify, projectId, snapshotId),
    restore: (projectId, snapshotId) => ipcRenderer.invoke(IPC.projectBackupsRestore, projectId, snapshotId),
    settings: (projectId) => ipcRenderer.invoke(IPC.projectBackupsSettings, projectId),
    setSettings: (projectId, settings) => ipcRenderer.invoke(IPC.projectBackupsSetSettings, projectId, settings)
  },
  smartViews: {
    list: () => ipcRenderer.invoke(IPC.smartViewsList),
    create: (input) => ipcRenderer.invoke(IPC.smartViewsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.smartViewsUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.smartViewsDelete, id)
  },
  mobileIndex: {
    read: (projectId) => ipcRenderer.invoke(IPC.mobileIndexRead, projectId),
    candidates: (projectId) => ipcRenderer.invoke(IPC.mobileIndexCandidates, projectId),
    write: (projectId, index) => ipcRenderer.invoke(IPC.mobileIndexWrite, projectId, index)
  },
  github: {
    status: (projectId) => ipcRenderer.invoke(IPC.githubStatus, projectId),
    configure: (projectId, settings) => ipcRenderer.invoke(IPC.githubConfigure, projectId, settings),
    syncNow: (projectId) => ipcRenderer.invoke(IPC.githubSyncNow, projectId),
    setAutoSync: (projectId, enabled) => ipcRenderer.invoke(IPC.githubSetAutoSync, projectId, enabled),
    setIdentity: (projectId, identity) => ipcRenderer.invoke(IPC.githubSetIdentity, projectId, identity),
    authStatus: () => ipcRenderer.invoke(IPC.githubAuthStatus),
    beginLogin: () => ipcRenderer.invoke(IPC.githubBeginLogin),
    createRepository: (projectId, options) => ipcRenderer.invoke(IPC.githubCreateRepository, projectId, options),
    setVisibility: (projectId, visibility) => ipcRenderer.invoke(IPC.githubSetVisibility, projectId, visibility),
    openRemote: (projectId) => ipcRenderer.invoke(IPC.githubOpenRemote, projectId),
    openProductPage: () => ipcRenderer.invoke(IPC.githubOpenProductPage),
    openCliDownload: () => ipcRenderer.invoke(IPC.githubOpenCliDownload),
    securityPreflight: (projectId, includeTracked) => ipcRenderer.invoke(IPC.githubSecurityPreflight, projectId, includeTracked),
    acknowledgeWarnings: (projectId, paths) => ipcRenderer.invoke(IPC.githubAcknowledgeWarnings, projectId, paths),
    history: (projectId, limit) => ipcRenderer.invoke(IPC.githubHistory, projectId, limit),
    syncAll: () => ipcRenderer.invoke(IPC.githubSyncAll),
    pauseAll: () => ipcRenderer.invoke(IPC.githubPauseAll),
    resumeAll: () => ipcRenderer.invoke(IPC.githubResumeAll),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on(IPC.githubEvent, handler);
      return () => ipcRenderer.removeListener(IPC.githubEvent, handler);
    }
  },
  runtime: {
    settings: () => ipcRenderer.invoke(IPC.runtimeSettings),
    setSettings: (settings) => ipcRenderer.invoke(IPC.runtimeSetSettings, settings),
    environmentStatus: () => ipcRenderer.invoke(IPC.runtimeEnvironmentStatus)
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    setSettings: (settings) => ipcRenderer.invoke(IPC.updatesSetSettings, settings),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    cancel: () => ipcRenderer.invoke(IPC.updatesCancel),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    openRelease: () => ipcRenderer.invoke(IPC.updatesOpenRelease),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
      ipcRenderer.on(IPC.updatesEvent, handler);
      return () => ipcRenderer.removeListener(IPC.updatesEvent, handler);
    }
  },
  references: {
    list: (projectId) => ipcRenderer.invoke(IPC.referencesList, projectId),
    import: (projectId) => ipcRenderer.invoke(IPC.referencesImport, projectId),
    open: (projectId, relativePath) => ipcRenderer.invoke(IPC.referencesOpen, projectId, relativePath),
    openFolder: (projectId) => ipcRenderer.invoke(IPC.referencesOpenFolder, projectId),
    remove: (projectId, relativePath) => ipcRenderer.invoke(IPC.referencesRemove, projectId, relativePath)
  },
    research: {
      list: (projectId) => ipcRenderer.invoke(IPC.researchList, projectId),
      listGlobal: () => ipcRenderer.invoke(IPC.researchListGlobal),
      discoverLegacy: (projectId) => ipcRenderer.invoke(IPC.researchDiscoverLegacy, projectId),
      save: (projectId, request) => ipcRenderer.invoke(IPC.researchSave, projectId, request),
      openAttachment: (projectId, itemId, attachmentId) => ipcRenderer.invoke(IPC.researchOpenAttachment, projectId, itemId, attachmentId)
  },
  researchSearch: {
    index: (projectId) => ipcRenderer.invoke(IPC.researchSearchIndex, projectId),
    indexAll: () => ipcRenderer.invoke(IPC.researchSearchIndexAll),
    query: (query, projectIds, limit) => ipcRenderer.invoke(IPC.researchSearchQuery, query, projectIds, limit)
  },
  manifest: {
    read: (projectRoot) => ipcRenderer.invoke(IPC.manifestRead, projectRoot),
    write: (projectRoot, manifest) => ipcRenderer.invoke(IPC.manifestWrite, projectRoot, manifest)
  },
  migration: {
    preview: (projectRoot, entryPath) => ipcRenderer.invoke(IPC.migrationPreview, projectRoot, entryPath)
  },
  files: {
    list: (projectId, options) => ipcRenderer.invoke(IPC.fileList, projectId, options),
    createDirectory: (projectId, parentPath, name) => ipcRenderer.invoke(IPC.fileCreateDirectory, projectId, parentPath, name),
    create: (projectId, parentPath, name) => ipcRenderer.invoke(IPC.fileCreate, projectId, parentPath, name),
    import: (projectId, destinationDirectory) => ipcRenderer.invoke(IPC.fileImport, projectId, destinationDirectory),
    plan: (projectId, request) => ipcRenderer.invoke(IPC.filePlan, projectId, request),
    apply: (projectId, planId) => ipcRenderer.invoke(IPC.fileApply, projectId, planId),
    undo: (projectId, undoId) => ipcRenderer.invoke(IPC.fileUndo, projectId, undoId),
    history: (projectId, limit) => ipcRenderer.invoke(IPC.fileHistory, projectId, limit),
    open: (projectId, path) => ipcRenderer.invoke(IPC.fileOpen, projectId, path),
    reveal: (projectId, path) => ipcRenderer.invoke(IPC.fileReveal, projectId, path),
    rename: (projectRoot, fromPath, toPath, expectedHash) => ipcRenderer.invoke(IPC.fileRename, projectRoot, fromPath, toPath, expectedHash),
    move: (projectRoot, fromPath, toPath, expectedHash) => ipcRenderer.invoke(IPC.fileMove, projectRoot, fromPath, toPath, expectedHash),
    trash: (projectRoot, path) => ipcRenderer.invoke(IPC.fileTrash, projectRoot, path),
    delete: (projectRoot, path) => ipcRenderer.invoke(IPC.fileDelete, projectRoot, path)
  },
  templates: {
    list: () => ipcRenderer.invoke(IPC.templatesList),
    create: (sourceRoot, name) => ipcRenderer.invoke(IPC.templatesCreate, sourceRoot, name),
    createFromProject: (projectId, options) => ipcRenderer.invoke(IPC.templatesCreateFromProject, projectId, options),
    delete: (templateId) => ipcRenderer.invoke(IPC.templatesDelete, templateId),
    instantiate: (templateId, parentRoot, name) => ipcRenderer.invoke(IPC.templatesInstantiate, templateId, parentRoot, name)
  },
  toolchains: {
    list: () => ipcRenderer.invoke(IPC.toolchainsList)
  },
  vscode: {
    status: () => ipcRenderer.invoke(IPC.vscodeStatus),
    openProject: (projectRoot) => ipcRenderer.invoke(IPC.vscodeOpenProject, projectRoot),
    openFile: (projectRoot, relativePath, line) =>
      ipcRenderer.invoke(IPC.vscodeOpenFile, projectRoot, relativePath, line),
    openProfile: (projectRoot, targetId, profileId) =>
      ipcRenderer.invoke(IPC.vscodeOpenProfile, projectRoot, targetId, profileId)
  },
  dialogs: {
    openDirectory: () => ipcRenderer.invoke(IPC.dialogOpenDirectory),
    openFile: (filters) => ipcRenderer.invoke(IPC.dialogOpenFile, filters)
  },
  editor: {
    status: () => ipcRenderer.invoke(IPC.editorStatus),
    selectExecutable: () => ipcRenderer.invoke(IPC.editorSelectExecutable),
    resetExecutable: () => ipcRenderer.invoke(IPC.editorResetExecutable),
    openProject: (projectId) => ipcRenderer.invoke(IPC.editorOpenProject, projectId),
    openFile: (projectId, relativePath, line, column) =>
      ipcRenderer.invoke(IPC.editorOpenFile, projectId, relativePath, line, column),
    openExternal: (path, line) => ipcRenderer.invoke(IPC.editorOpenExternal, path, line)
  }
};

contextBridge.exposeInMainWorld("workbench", api);
