import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from "electron";
import { IPC } from "../shared/ipc";
import type {
  AppUpdateSettings,
  BuildEvent,
  BuildRequest,
  ExportResult,
  FileWriteRequest,
  GitHubCreateRepositoryOptions,
  GitHubRepositoryVisibility,
  GitHubSyncSettings,
  GitIdentity,
  MigrationPreview,
  ProjectManifest,
  ProjectPdfInfo,
  ProjectSummary,
  ScanCandidate,
  ScanOptions
} from "../shared/types";
import { BuildService, selectBuildEngine } from "./services/build";
import { createProjectCatalog } from "./services/catalog";
import { TemporaryCleanupService } from "./services/cleanup";
import { ProjectAccessController, ProjectAccessError } from "./services/access-control";
import { ProjectFileService } from "./services/files";
import { GitHubSyncService } from "./services/github-sync";
import { AppUpdateService } from "./services/app-updates";
import {
  getManifestPath,
  readProjectManifest,
  readProjectManifestIfExists,
  writeProjectManifest
} from "./services/manifest";
import { applyMigration, previewMigration, rollbackMigration } from "./services/migration";
import { createProjectId } from "./services/project-id";
import { ProjectOperationsService } from "./services/project-operations";
import { ProjectStorageService } from "./services/project-storage";
import { ReferenceService } from "./services/references";
import { relinkCatalogProject } from "./services/project-relink";
import { createProfileRuntime } from "./services/profile-runtime";
import { scanLibrary } from "./services/scanner";
import { SyncTexService } from "./services/synctex";
import { TemplateService } from "./services/templates";
import { detectToolchains, resolveToolchain } from "./services/toolchain";
import { VsCodeService } from "./services/vscode";

let registered = false;

function summaryFromCandidate(candidate: ScanCandidate, projectId = createProjectId()): ProjectSummary {
  return {
    id: projectId,
    name: candidate.name,
    rootPath: resolve(candidate.rootPath),
    targetCount: candidate.entries.length,
    classNames: [...new Set(candidate.entries.map((entry) => entry.className))],
    lastOpenedAt: new Date().toISOString(),
    favorite: false,
    archived: false,
    trashed: false,
    tags: [],
    pathAvailable: existsSync(candidate.rootPath)
  };
}

type InvokeHandler<T extends unknown[], TResult> = (...args: T) => TResult | Promise<TResult>;

let currentWindowGetter: (() => BrowserWindow | null) | null = null;
let currentTrustedUrl: ((url: string) => boolean) | null = null;

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !/^[a-zA-Z]:|^[\\/]/.test(relation));
}

function isSafeExternalEditorPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return new Set([".tex", ".bib", ".cls", ".sty", ".cfg", ".def", ".txt", ".md", ".pdf", ".log", ".aux", ".idx", ".ind"]).has(extension);
}

function exportFileName(value: string, extension: ".zip" | ".pdf"): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "latex-project";
  return `${cleaned}${extension}`;
}

function register<T extends unknown[], TResult>(
  channel: string,
  handler: InvokeHandler<T, TResult>,
  getWindow = currentWindowGetter ?? (() => null),
  isTrustedUrl = currentTrustedUrl ?? (() => false)
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isTrustedUrl(event.senderFrame.url)) {
      throw new Error("Unauthorized renderer IPC call.");
    }
    return handler(...(args as T));
  });
}

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  isTrustedUrl: (url: string) => boolean = () => false
): void {
  if (registered) return;
  registered = true;
  currentWindowGetter = getWindow;
  currentTrustedUrl = isTrustedUrl;

  const userData = app.getPath("userData");
  const catalog = createProjectCatalog(join(userData, "library.sqlite"));
  const access = new ProjectAccessController(
    catalog.list().filter((project) => !project.trashed).map((project) => project.rootPath)
  );
  const pendingCandidates = new Map<string, ScanCandidate>();
  const manifestHashes = new Map<string, string>();

  const rootKey = (root: string): string => {
    const normalized = resolve(root);
    return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
  };
  const requireProject = (root: string): Promise<string> => access.requireProjectRoot(root);
  const requireProjectPath = async (path: string): Promise<{ root: string; path: string }> => access.requireProjectForPath(path);
  const readManifestWithHash = async (root: string): Promise<ProjectManifest> => {
    const canonicalRoot = await requireProject(root);
    const manifest = await readProjectManifest(canonicalRoot);
    const bytes = await readFile(getManifestPath(canonicalRoot));
    manifestHashes.set(rootKey(canonicalRoot), createHash("sha256").update(bytes).digest("hex"));
    return manifest;
  };
  const projectAtRoot = (root: string): ProjectSummary | undefined =>
    catalog.list().find((project) => rootKey(project.rootPath) === rootKey(root));
  const requireCatalogProject = (projectId: string, allowTrashed = false): ProjectSummary => {
    if (typeof projectId !== "string" || !projectId) throw new Error("A project ID is required.");
    const project = catalog.get(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    if (project.trashed && !allowTrashed) throw new Error("Restore the project from the application trash before using it.");
    return project;
  };
  const requireCatalogProjectRoot = async (projectId: string): Promise<{ project: ProjectSummary; root: string }> => {
    const project = requireCatalogProject(projectId);
    return { project, root: await requireProject(project.rootPath) };
  };
  const requireManifestIdentity = (root: string, manifest: ProjectManifest): ProjectSummary => {
    const project = projectAtRoot(root);
    if (!project || project.id !== manifest.projectId) {
      throw new Error("The manifest project ID does not match the registered project.");
    }
    return project;
  };
  const buildService = new BuildService();
  const syncTex = new SyncTexService();
  const files = new ProjectFileService();
  const github = new GitHubSyncService(join(userData, "github-sync"));
  const updates = new AppUpdateService(join(userData, "updates"), { currentVersion: app.getVersion() });
  const references = new ReferenceService({
    openPath: (path) => shell.openPath(path),
    trashItem: (path) => shell.trashItem(path)
  });
  const templates = new TemplateService(join(userData, "templates"));
  const vscode = new VsCodeService();
  const projectOperations = new ProjectOperationsService();
  const cleanup = new TemporaryCleanupService();
  const storage = new ProjectStorageService();
  for (const project of catalog.list().filter((item) => !item.trashed && item.pathAvailable)) {
    void github.attachProject(project.id, project.rootPath);
  }
  const updateTimer = setTimeout(() => { void updates.checkAutomatically(); }, 2_500);
  updateTimer.unref();
  const showSaveDialog = async (options: SaveDialogOptions): Promise<string | null> => {
    const owner = getWindow();
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  };
  const lastSuccessfulPdf = async (projectId: string): Promise<{ project: ProjectSummary; pdf: ProjectPdfInfo } | null> => {
    const { project, root } = await requireCatalogProjectRoot(projectId);
    const manifest = await readProjectManifestIfExists(root);
    const pdf = await projectOperations.lastSuccessfulPdf(root, manifest);
    return pdf ? { project, pdf } : null;
  };

  register(IPC.libraryList, () => catalog.list());
  register(IPC.libraryScan, async (rootPath: string, options?: Partial<ScanOptions>) => {
    let selectedRoot: string;
    try {
      selectedRoot = await access.requireSelection(rootPath);
    } catch {
      // A previously imported project may be rescanned after an app restart;
      // it is already authorized by the persistent catalog.
      selectedRoot = await requireProject(rootPath);
    }
    const candidates = await scanLibrary(selectedRoot, options);
    const safeCandidates: ScanCandidate[] = [];
    for (const candidate of candidates) {
      const canonicalRoot = await access.registerPendingCandidate(candidate.rootPath);
      const safeCandidate = { ...candidate, rootPath: canonicalRoot };
      pendingCandidates.set(rootKey(canonicalRoot), safeCandidate);
      safeCandidates.push(safeCandidate);
    }
    return safeCandidates;
  });
  register(IPC.libraryImport, async (candidate: ScanCandidate) => {
    const canonicalRoot = await access.consumePendingCandidate(candidate.rootPath);
    const issued = pendingCandidates.get(rootKey(canonicalRoot));
    if (!issued) throw new ProjectAccessError("The scan result is stale; scan again before importing.", "ROOT_NOT_AUTHORIZED");
    pendingCandidates.delete(rootKey(canonicalRoot));
    const existingManifest = await readProjectManifestIfExists(canonicalRoot);
    const summary = summaryFromCandidate(
      { ...issued, rootPath: canonicalRoot },
      existingManifest?.projectId
    );
    const imported = catalog.upsert(summary);
    await github.attachProject(imported.id, imported.rootPath);
    return imported;
  });
  register(IPC.libraryRelink, async (projectId: string, rootPath: string) => {
    requireCatalogProject(projectId);
    const canonicalRoot = await access.requireSelection(rootPath);
    const current = catalog.get(projectId);
    const relinked = await relinkCatalogProject(catalog, projectId, canonicalRoot);
    await access.addProjectRoot(relinked.rootPath);
    if (current && rootKey(current.rootPath) !== rootKey(relinked.rootPath)) {
      access.removeProjectRoot(current.rootPath);
      manifestHashes.delete(rootKey(current.rootPath));
    }
    manifestHashes.delete(rootKey(relinked.rootPath));
    await github.detachProject(projectId);
    await github.attachProject(projectId, relinked.rootPath);
    return relinked;
  });
  register(
    IPC.libraryUpdate,
    async (
      projectId: string,
      patch: Partial<Pick<ProjectSummary, "name" | "favorite" | "archived" | "trashed" | "tags">>
    ) => {
      const current = requireCatalogProject(projectId, true);
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("A project update is required.");
      const allowed = new Set(["name", "favorite", "archived", "trashed", "tags"]);
      if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error("The project update contains unsupported fields.");
      const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(patch, key);
      if (has("name") && (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > 240)) {
        throw new Error("The project name must be a non-empty string of at most 240 characters.");
      }
      for (const key of ["favorite", "archived", "trashed"] as const) {
        if (has(key) && typeof patch[key] !== "boolean") throw new Error(`${key} must be a boolean.`);
      }
      if (has("tags") && (!Array.isArray(patch.tags) || patch.tags.length > 100 || patch.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 100))) {
        throw new Error("Tags must be an array of at most 100 non-empty strings, each at most 100 characters.");
      }
      if (patch.trashed === false && current.trashed && existsSync(current.rootPath)) {
        await access.addProjectRoot(current.rootPath);
      }
      const updated = catalog.update(projectId, patch);
      if (updated.trashed) {
        access.removeProjectRoot(updated.rootPath);
        manifestHashes.delete(rootKey(updated.rootPath));
        await github.detachProject(updated.id);
      } else if (patch.trashed === false) {
        await github.attachProject(updated.id, updated.rootPath);
      }
      return updated;
    }
  );
  register(IPC.libraryOpenFolder, async (projectId: string) => {
    const { project, root } = await requireCatalogProjectRoot(projectId);
    const error = await shell.openPath(root);
    if (error) throw new Error(error);
    catalog.markOpened(project.id);
  });
  register(IPC.libraryOpenInVsCode, async (projectId: string) => {
    const { project, root } = await requireCatalogProjectRoot(projectId);
    await vscode.openProject(root);
    catalog.markOpened(project.id);
  });
  register(IPC.libraryCopy, async (projectId: string, destinationParent: string, name: string) => {
    if (typeof destinationParent !== "string" || typeof name !== "string") {
      throw new Error("A selected destination and project name are required.");
    }
    const { project, root } = await requireCatalogProjectRoot(projectId);
    const parent = await access.requireSelection(destinationParent);
    const copied = await projectOperations.copy(root, parent, name);
    let summary: ProjectSummary;
    if (copied.manifest) {
      summary = catalog.upsertManifest(copied.rootPath, copied.manifest);
    } else {
      summary = catalog.upsert({
        ...project,
        id: createProjectId(),
        name: basename(copied.rootPath),
        rootPath: copied.rootPath,
        lastOpenedAt: new Date().toISOString(),
        lastBuildAt: undefined,
        lastBuildStatus: undefined,
        favorite: false,
        archived: false,
        trashed: false,
        trashedAt: undefined,
        tags: [...project.tags],
        thumbnailPath: undefined,
        pathAvailable: true
      });
    }
    await access.addProjectRoot(copied.rootPath);
    await github.attachProject(summary.id, summary.rootPath);
    return summary;
  });
  register(IPC.libraryExportZip, async (projectId: string): Promise<ExportResult> => {
    const { project, root } = await requireCatalogProjectRoot(projectId);
    const destination = await showSaveDialog({
      title: "导出项目 ZIP",
      defaultPath: join(app.getPath("downloads"), exportFileName(project.name, ".zip")),
      filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (!destination) return { canceled: true };
    const output = await projectOperations.exportZip(root, destination);
    return { canceled: false, path: output };
  });
  register(IPC.libraryLastSuccessfulPdf, async (projectId: string) => {
    const result = await lastSuccessfulPdf(projectId);
    return result?.pdf ?? null;
  });
  register(IPC.libraryOpenLastSuccessfulPdf, async (projectId: string) => {
    const result = await lastSuccessfulPdf(projectId);
    if (!result) throw new Error("This project does not have a successful PDF build yet.");
    const error = await shell.openPath(result.pdf.path);
    if (error) throw new Error(error);
  });
  register(IPC.libraryExportLastSuccessfulPdf, async (projectId: string): Promise<ExportResult> => {
    const result = await lastSuccessfulPdf(projectId);
    if (!result) throw new Error("This project does not have a successful PDF build yet.");
    const destination = await showSaveDialog({
      title: "导出最后成功 PDF",
      defaultPath: join(app.getPath("downloads"), exportFileName(result.project.name, ".pdf")),
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (!destination) return { canceled: true };
    const output = await projectOperations.exportPdf(result.project.rootPath, result.pdf.path, destination);
    return { canceled: false, path: output };
  });
  register(IPC.libraryCleanupPreview, async (projectId: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return cleanup.preview(projectId, root);
  });
  register(IPC.libraryCleanupApply, async (projectId: string, planId: string) => {
    if (typeof planId !== "string" || !planId) throw new Error("A cleanup plan ID is required.");
    const { project, root } = await requireCatalogProjectRoot(projectId);
    const result = await cleanup.apply(projectId, root, planId);
    await github.notifyProjectChanged(project.id, root);
    return result;
  });
  register(IPC.libraryStorageInfo, async (projectId: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return storage.measure(root);
  });

  register(IPC.githubStatus, async (projectId: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return github.status(projectId, root);
  });
  register(IPC.githubConfigure, async (projectId: string, settings: GitHubSyncSettings) => {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("GitHub 同步设置无效。");
    const { root } = await requireCatalogProjectRoot(projectId);
    return github.configure(projectId, root, settings);
  });
  register(IPC.githubSyncNow, async (projectId: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return github.syncNow(projectId, root, false);
  });
  register(IPC.githubSetAutoSync, async (projectId: string, enabled: boolean) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return github.setAutoSync(projectId, root, enabled);
  });
  register(IPC.githubSetIdentity, async (projectId: string, identity: Pick<GitIdentity, "name" | "email">) => {
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("Git 提交身份无效。");
    const { root } = await requireCatalogProjectRoot(projectId);
    return github.setIdentity(projectId, root, identity);
  });
  register(IPC.githubAuthStatus, () => github.authStatus(userData));
  register(IPC.githubBeginLogin, () => github.beginLogin(userData));
  register(IPC.githubCreateRepository, async (projectId: string, options: GitHubCreateRepositoryOptions) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return github.createRepository(projectId, root, options);
  });
  register(IPC.githubSetVisibility, async (projectId: string, visibility: GitHubRepositoryVisibility) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return github.setVisibility(projectId, root, visibility);
  });
  register(IPC.githubOpenRemote, async (projectId: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    await shell.openExternal(await github.remoteWebUrl(projectId, root));
  });
  register(IPC.githubOpenProductPage, () => shell.openExternal("https://github.com/Ararataki-number-one/latex-project-manager"));
  register(IPC.githubOpenCliDownload, () => shell.openExternal("https://cli.github.com/"));

  register(IPC.updatesStatus, () => updates.status());
  register(IPC.updatesSetSettings, async (settings: AppUpdateSettings) => {
    const status = await updates.setSettings(settings);
    if (settings.autoCheck) return updates.check(settings.autoDownload);
    return status;
  });
  register(IPC.updatesCheck, () => updates.check(false));
  register(IPC.updatesDownload, () => updates.download());
  register(IPC.updatesInstall, async () => {
    const installer = await updates.downloadedInstaller();
    const error = await shell.openPath(installer);
    if (error) throw new Error(error);
    const timer = setTimeout(() => app.quit(), 1_000);
    timer.unref();
  });
  register(IPC.updatesOpenRelease, async () => {
    const url = new URL((await updates.status()).releaseUrl);
    if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase("en-US") !== "github.com") {
      throw new Error("更新页面地址无效。");
    }
    await shell.openExternal(url.href);
  });

  register(IPC.referencesList, async (projectId: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    return references.list(root);
  });
  register(IPC.referencesImport, async (projectId: string) => {
    const { project, root } = await requireCatalogProjectRoot(projectId);
    const options: OpenDialogOptions = {
      title: "添加原始文稿",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "原始文稿", extensions: ["pdf", "epub", "djvu", "mobi", "azw3", "doc", "docx", "odt", "rtf", "txt", "md", "html", "htm", "tex", "bib", "zip"] },
        { name: "PDF", extensions: ["pdf"] }
      ]
    };
    const owner = getWindow();
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return references.list(root);
    const items = await references.importFiles(root, result.filePaths);
    await github.notifyProjectChanged(project.id, root);
    return items;
  });
  register(IPC.referencesOpen, async (projectId: string, relativePath: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    await references.open(root, relativePath);
  });
  register(IPC.referencesOpenFolder, async (projectId: string) => {
    const { root } = await requireCatalogProjectRoot(projectId);
    await references.openFolder(root);
  });
  register(IPC.referencesRemove, async (projectId: string, relativePath: string) => {
    const { project, root } = await requireCatalogProjectRoot(projectId);
    const items = await references.remove(root, relativePath);
    await github.notifyProjectChanged(project.id, root);
    return items;
  });

  register(IPC.manifestRead, async (projectRoot: string) => {
    const canonicalRoot = await requireProject(projectRoot);
    const manifest = await readManifestWithHash(canonicalRoot);
    requireManifestIdentity(canonicalRoot, manifest);
    const project = catalog.upsertManifest(canonicalRoot, manifest);
    catalog.markOpened(project.id);
    return manifest;
  });
  register(IPC.manifestWrite, async (projectRoot: string, manifest: ProjectManifest) => {
    const canonicalRoot = await requireProject(projectRoot);
    requireManifestIdentity(canonicalRoot, manifest);
    let expectedHash: string | null | undefined = manifestHashes.get(rootKey(canonicalRoot));
    if (expectedHash === undefined) {
      try {
        expectedHash = createHash("sha256").update(await readFile(getManifestPath(canonicalRoot))).digest("hex");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        expectedHash = null;
      }
    }
    const written = await writeProjectManifest(canonicalRoot, manifest, expectedHash);
    const bytes = await readFile(getManifestPath(canonicalRoot));
    manifestHashes.set(rootKey(canonicalRoot), createHash("sha256").update(bytes).digest("hex"));
    catalog.upsertManifest(canonicalRoot, written);
    const summary = projectAtRoot(canonicalRoot);
    if (summary) await github.notifyProjectChanged(summary.id, canonicalRoot);
    return written;
  });

  register(IPC.migrationPreview, async (projectRoot: string, entryPath: string) => {
    const canonicalRoot = await requireProject(projectRoot);
    const project = projectAtRoot(canonicalRoot);
    if (!project) throw new Error("The project root is not registered in the library.");
    return previewMigration(canonicalRoot, entryPath, project.id);
  });
  register(IPC.migrationApply, async (preview: MigrationPreview, selectedChangeIds: string[]) => {
    const canonicalRoot = await requireProject(preview.projectRoot);
    requireManifestIdentity(canonicalRoot, preview.manifest);
    const manifest = await applyMigration({ ...preview, projectRoot: canonicalRoot }, selectedChangeIds);
    requireManifestIdentity(canonicalRoot, manifest);
    try {
      const bytes = await readFile(getManifestPath(canonicalRoot));
      manifestHashes.set(rootKey(canonicalRoot), createHash("sha256").update(bytes).digest("hex"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      manifestHashes.delete(rootKey(canonicalRoot));
    }
    catalog.upsertManifest(canonicalRoot, manifest);
    return manifest;
  });
  register(IPC.migrationRollback, async (projectRoot: string, snapshotId: string) => {
    const canonicalRoot = await requireProject(projectRoot);
    await rollbackMigration(canonicalRoot, snapshotId);
    try {
      const bytes = await readFile(getManifestPath(canonicalRoot));
      manifestHashes.set(rootKey(canonicalRoot), createHash("sha256").update(bytes).digest("hex"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      manifestHashes.delete(rootKey(canonicalRoot));
    }
  });

  buildService.onEvent((event: BuildEvent) => {
    getWindow()?.webContents.send(IPC.buildEvent, event);
    if (["success", "warning", "failed", "cancelled"].includes(event.status)) {
      const summary = projectAtRoot(event.projectRoot);
      if (summary) catalog.markBuild(summary.id, event.status);
    }
  });
  register(IPC.buildStart, async (request: BuildRequest) => {
    if (request.shellEscape === true) {
      throw new Error("shell-escape requires an explicit trusted-command grant and is disabled for this project.");
    }
    const canonicalRoot = await requireProject(request.projectRoot);
    return buildService.start({ ...request, projectRoot: canonicalRoot, shellEscape: false });
  });
  register(IPC.buildCancel, (buildId: string) => buildService.cancel(buildId));
  register(IPC.buildStatus, (buildId?: string) => buildId ? buildService.status(buildId) : buildService.status());

  register(IPC.syncForward, async (sourcePath: string, line: number, column: number, pdfPath: string) => {
    const source = await requireProjectPath(sourcePath);
    const pdf = await requireProjectPath(pdfPath);
    if (rootKey(source.root) !== rootKey(pdf.root)) throw new ProjectAccessError("SyncTeX paths must belong to one project.", "PATH_NOT_AUTHORIZED");
    const location = await syncTex.forward(source.path, line, column, pdf.path);
    if (!location) return null;
    const returned = await requireProjectPath(isInside(source.root, resolve(location.file)) ? resolve(location.file) : resolve(source.root, location.file));
    if (rootKey(returned.root) !== rootKey(source.root)) throw new ProjectAccessError("SyncTeX returned a path outside the project.", "PATH_NOT_AUTHORIZED");
    return { ...location, file: returned.path };
  });
  register(IPC.syncBackward, async (pdfPath: string, page: number, x: number, y: number) => {
    const pdf = await requireProjectPath(pdfPath);
    const location = await syncTex.backward(pdf.path, page, x, y);
    if (!location) return null;
    const candidate = /^[a-zA-Z]:[\\/]|^[\\/]{1,2}/.test(location.file)
      ? location.file
      : resolve(pdf.root, location.file);
    const returned = await requireProjectPath(candidate);
    if (rootKey(returned.root) !== rootKey(pdf.root)) throw new ProjectAccessError("SyncTeX returned a path outside the project.", "PATH_NOT_AUTHORIZED");
    return { ...location, file: returned.path };
  });

  register(IPC.fileRead, async (projectRoot: string, path: string) => files.read(await requireProject(projectRoot), path));
  register(IPC.fileWrite, async (request: FileWriteRequest) => {
    const root = await requireProject(request.projectRoot);
    const result = await files.write({ ...request, projectRoot: root });
    const project = projectAtRoot(root);
    if (project) await github.notifyProjectChanged(project.id, root);
    return result;
  });
  register(IPC.fileRename, async (projectRoot: string, fromPath: string, toPath: string, expectedHash?: string) => {
    const root = await requireProject(projectRoot);
    const result = await files.rename(root, fromPath, toPath, expectedHash);
    const project = projectAtRoot(root);
    if (project) await github.notifyProjectChanged(project.id, root);
    return result;
  });
  register(IPC.fileMove, async (projectRoot: string, fromPath: string, toPath: string, expectedHash?: string) => {
    const root = await requireProject(projectRoot);
    const result = await files.move(root, fromPath, toPath, expectedHash);
    const project = projectAtRoot(root);
    if (project) await github.notifyProjectChanged(project.id, root);
    return result;
  });
  register(IPC.fileTrash, async (projectRoot: string, path: string) => {
    const root = await requireProject(projectRoot);
    await files.trash(root, path);
    const project = projectAtRoot(root);
    if (project) await github.notifyProjectChanged(project.id, root);
  });
  register(IPC.fileDelete, async (projectRoot: string, path: string) => {
    const root = await requireProject(projectRoot);
    await files.trash(root, path);
    const project = projectAtRoot(root);
    if (project) await github.notifyProjectChanged(project.id, root);
  });

  register(IPC.templatesList, () => templates.list());
  register(IPC.templatesCreate, async (sourceRoot: string, name: string) => {
    let canonicalRoot: string;
    try {
      canonicalRoot = await access.requireSelection(sourceRoot);
    } catch {
      canonicalRoot = await requireProject(sourceRoot);
    }
    return templates.create(canonicalRoot, name);
  });
  register(IPC.templatesInstantiate, async (templateId: string, parentRoot: string, name: string) =>
    templates.instantiate(templateId, await access.requireSelection(parentRoot), name)
  );
  register(IPC.toolchainsList, () => detectToolchains());
  register(IPC.vscodeStatus, () => vscode.status());
  register(IPC.vscodeOpenProject, async (projectRoot: string) => {
    if (typeof projectRoot !== "string") throw new Error("A project root is required.");
    await vscode.openProject(await requireProject(projectRoot));
  });
  register(IPC.vscodeOpenFile, async (projectRoot: string, relativePath: string, line?: number) => {
    if (typeof projectRoot !== "string" || typeof relativePath !== "string") {
      throw new Error("A project root and relative file path are required.");
    }
    const canonicalRoot = await requireProject(projectRoot);
    const owned = await requireProjectPath(resolve(canonicalRoot, relativePath));
    if (rootKey(owned.root) !== rootKey(canonicalRoot)) {
      throw new ProjectAccessError("The editor target must belong to the selected project.", "PATH_NOT_AUTHORIZED");
    }
    if (!isSafeExternalEditorPath(owned.path)) throw new Error("Only project text/PDF files can be opened externally.");
    await vscode.openFile(canonicalRoot, owned.path, line);
  });
  register(IPC.vscodeOpenProfile, async (projectRoot: string, targetId: string, profileId: string) => {
    if (typeof projectRoot !== "string" || typeof targetId !== "string" || typeof profileId !== "string") {
      throw new Error("A project root, document target, and build profile are required.");
    }
    const canonicalRoot = await requireProject(projectRoot);
    const manifest = await readManifestWithHash(canonicalRoot);
    requireManifestIdentity(canonicalRoot, manifest);
    const target = manifest.targets.find((item) => item.id === targetId);
    if (!target) throw new Error(`Unknown document target: ${targetId}`);
    const profile = target.profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error(`Unknown build profile: ${profileId}`);
    const [entrySource, toolchain] = await Promise.all([
      readFile(resolve(canonicalRoot, target.entry), "utf8"),
      resolveToolchain(target.texDistribution)
    ]);
    if (!toolchain) throw new Error("No configured TeX toolchain is available for the selected profile.");
    const engine = selectBuildEngine(target, toolchain, entrySource);
    const runtime = await createProfileRuntime(canonicalRoot, target, profile, { engine });
    await vscode.openFile(canonicalRoot, runtime.wrapperPath);
    return relative(canonicalRoot, runtime.wrapperPath).split(sep).join("/");
  });

  register(IPC.dialogOpenDirectory, async () => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory"]
    };
    const owner = getWindow();
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return access.addSelection(result.filePaths[0]);
  });
  register(IPC.dialogOpenFile, async (filters?: OpenDialogOptions["filters"]) => {
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters
    };
    const owner = getWindow();
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  register(IPC.editorOpenExternal, async (path: string, line?: number) => {
    const owned = await requireProjectPath(path);
    if (!isSafeExternalEditorPath(owned.path)) throw new Error("Only project text/PDF files can be opened externally.");
    if (vscode.status().available) {
      await vscode.openFile(owned.root, owned.path, line);
      return;
    }
    const error = await shell.openPath(owned.path);
    if (error) throw new Error(error);
  });

  app.once("before-quit", () => {
    void github.dispose();
    catalog.close();
  });
}
