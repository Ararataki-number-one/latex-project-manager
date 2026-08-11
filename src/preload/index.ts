import { contextBridge, ipcRenderer } from "electron";
import { IPC, type WorkbenchApi } from "../shared/ipc";

const api: WorkbenchApi = {
  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    scan: (rootPath, options) => ipcRenderer.invoke(IPC.libraryScan, rootPath, options),
    import: (candidate) => ipcRenderer.invoke(IPC.libraryImport, candidate),
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
    openCliDownload: () => ipcRenderer.invoke(IPC.githubOpenCliDownload)
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    setSettings: (settings) => ipcRenderer.invoke(IPC.updatesSetSettings, settings),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    openRelease: () => ipcRenderer.invoke(IPC.updatesOpenRelease)
  },
  references: {
    list: (projectId) => ipcRenderer.invoke(IPC.referencesList, projectId),
    import: (projectId) => ipcRenderer.invoke(IPC.referencesImport, projectId),
    open: (projectId, relativePath) => ipcRenderer.invoke(IPC.referencesOpen, projectId, relativePath),
    openFolder: (projectId) => ipcRenderer.invoke(IPC.referencesOpenFolder, projectId),
    remove: (projectId, relativePath) => ipcRenderer.invoke(IPC.referencesRemove, projectId, relativePath)
  },
  manifest: {
    read: (projectRoot) => ipcRenderer.invoke(IPC.manifestRead, projectRoot),
    write: (projectRoot, manifest) => ipcRenderer.invoke(IPC.manifestWrite, projectRoot, manifest)
  },
  migration: {
    preview: (projectRoot, entryPath) => ipcRenderer.invoke(IPC.migrationPreview, projectRoot, entryPath)
  },
  files: {
    rename: (projectRoot, fromPath, toPath, expectedHash) => ipcRenderer.invoke(IPC.fileRename, projectRoot, fromPath, toPath, expectedHash),
    move: (projectRoot, fromPath, toPath, expectedHash) => ipcRenderer.invoke(IPC.fileMove, projectRoot, fromPath, toPath, expectedHash),
    trash: (projectRoot, path) => ipcRenderer.invoke(IPC.fileTrash, projectRoot, path),
    delete: (projectRoot, path) => ipcRenderer.invoke(IPC.fileDelete, projectRoot, path)
  },
  templates: {
    list: () => ipcRenderer.invoke(IPC.templatesList),
    create: (sourceRoot, name) => ipcRenderer.invoke(IPC.templatesCreate, sourceRoot, name),
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
    openExternal: (path, line) => ipcRenderer.invoke(IPC.editorOpenExternal, path, line)
  }
};

contextBridge.exposeInMainWorld("workbench", api);
