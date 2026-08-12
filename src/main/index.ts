import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Notification, screen, session, shell, Tray } from "electron";
import { registerIpcHandlers, type IpcRuntimeController } from "./ipc";
import type { AppRuntimeSettings, GitHubSyncEvent } from "../shared/types";
import { isTrustedRendererUrl, rendererContentSecurityPolicy } from "./services/electron-security";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: IpcRuntimeController | null = null;
let quitting = false;
const isDevelopment = !app.isPackaged;

function rendererDocumentUrl(): string {
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    return new URL(process.env.ELECTRON_RENDERER_URL).href;
  }
  return pathToFileURL(join(__dirname, "../renderer/index.html")).href;
}

function createWindow(allowedUrl: string): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const initialWidth = Math.min(1480, Math.max(760, workArea.width - 32));
  const initialHeight = Math.min(940, Math.max(560, workArea.height - 32));
  const supportsSystemGlass = process.platform === "win32" && Number.parseInt(process.getSystemVersion().split(".")[2] ?? "0", 10) >= 22000;
  const window = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: Math.min(980, initialWidth),
    minHeight: Math.min(680, initialHeight),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17191c" : "#f5f6f7",
    title: "LaTeX 项目管理器",
    autoHideMenuBar: true,
    ...(supportsSystemGlass ? { backgroundMaterial: "mica" as const } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDevelopment
    }
  });
  window.center();

  if (supportsSystemGlass) window.setBackgroundMaterial("mica");

  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    // A renderer can finish before Chromium emits ready-to-show on some Windows
    // graphics/scale combinations. Never leave the app running only in the tray.
    if (!window.isVisible()) window.show();
  });
  window.webContents.once("did-fail-load", () => {
    if (!window.isVisible()) window.show();
  });
  window.webContents.once("render-process-gone", () => {
    if (!window.isVisible()) window.show();
  });
  window.on("close", (event) => {
    if (!quitting && runtime?.runtimeSettings().closeToTray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") void shell.openExternal(parsed.href);
    } catch {
      // Unknown protocols are denied below.
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, allowedUrl)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedRendererUrl(url, allowedUrl)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(allowedUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function trayImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111"/><path d="M7 10h7l2 3h9v11H7z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M11 18h10" stroke="#10a37f" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).resize({ width: 20, height: 20 });
}

function rebuildTrayMenu(settings: AppRuntimeSettings): void {
  if (!tray || !runtime) return;
  tray.setToolTip(settings.syncPaused ? "LaTeX 项目管理器 · 同步已暂停" : "LaTeX 项目管理器 · 后台同步中");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 LaTeX 项目管理器", click: showMainWindow },
    { type: "separator" },
    { label: "立即同步全部项目", enabled: !settings.syncPaused, click: () => void runtime?.syncAll() },
    settings.syncPaused
      ? { label: "恢复自动同步", click: () => void runtime?.resumeSync().then(() => rebuildTrayMenu(runtime!.runtimeSettings())) }
      : { label: "暂停自动同步", click: () => void runtime?.pauseSync().then(() => rebuildTrayMenu(runtime!.runtimeSettings())) },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } }
  ]));
}

function notifySyncProblem(event: GitHubSyncEvent): void {
  if (!new Set(["blocked", "needsPull", "error"]).has(event.state) || !Notification.isSupported()) return;
  new Notification({ title: "LaTeX 项目同步需要处理", body: event.message, silent: false }).show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("local.latex.workbench");
    const allowedUrl = rendererDocumentUrl();
    const rendererSession = session.defaultSession;
    rendererSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    rendererSession.setPermissionCheckHandler(() => false);
    rendererSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType !== "mainFrame" || !isTrustedRendererUrl(details.url, allowedUrl)) {
        callback({});
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [rendererContentSecurityPolicy(isDevelopment)]
        }
      });
    });
    runtime = registerIpcHandlers(
      () => mainWindow,
      (url) => isTrustedRendererUrl(url, allowedUrl),
      {
        onSyncEvent: notifySyncProblem,
        onRuntimeSettingsChanged: rebuildTrayMenu
      }
    );
    mainWindow = createWindow(allowedUrl);
    tray = new Tray(trayImage());
    tray.on("double-click", showMainWindow);
    rebuildTrayMenu(runtime.runtimeSettings());

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow(allowedUrl);
      showMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && (!runtime || !runtime.runtimeSettings().closeToTray)) app.quit();
  });
  app.on("before-quit", () => { quitting = true; });
}
