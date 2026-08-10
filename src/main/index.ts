import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeTheme, session, shell } from "electron";
import { registerIpcHandlers } from "./ipc";
import { isTrustedRendererUrl, rendererContentSecurityPolicy } from "./services/electron-security";

let mainWindow: BrowserWindow | null = null;
const isDevelopment = !app.isPackaged;

function rendererDocumentUrl(): string {
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    return new URL(process.env.ELECTRON_RENDERER_URL).href;
  }
  return pathToFileURL(join(__dirname, "../renderer/index.html")).href;
}

function createWindow(allowedUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17191c" : "#f5f6f7",
    title: "LaTeX 项目管理器",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDevelopment
    }
  });

  window.on("ready-to-show", () => window.show());
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
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
    registerIpcHandlers(() => mainWindow, (url) => isTrustedRendererUrl(url, allowedUrl));
    mainWindow = createWindow(allowedUrl);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(allowedUrl);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
