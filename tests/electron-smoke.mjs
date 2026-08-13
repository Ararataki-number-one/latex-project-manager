import { mkdtemp, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron as electron } from "@playwright/test";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceBuild = process.env.ELECTRON_SMOKE_SOURCE === "1";
const executablePath = process.env.ELECTRON_SMOKE_EXECUTABLE
  ? resolve(process.env.ELECTRON_SMOKE_EXECUTABLE)
  : sourceBuild
    ? join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
    : join(projectRoot, "dist", "win-unpacked", "LaTeX 项目管理器.exe");
const userData = process.env.ELECTRON_SMOKE_USER_DATA
  ? resolve(process.env.ELECTRON_SMOKE_USER_DATA)
  : await mkdtemp(join(projectRoot, "test-results", "electron-smoke-"));
const executable = await stat(executablePath);
const electronEnvironment = { ...process.env };
// Node-oriented CI wrappers can leak these variables into Electron and make it
// exit before Playwright can attach to the main process.
delete electronEnvironment.ELECTRON_RUN_AS_NODE;
delete electronEnvironment.NODE_OPTIONS;
console.log(JSON.stringify({ sourceBuild, executablePath, executableBytes: executable.size, userData }));
const application = await electron.launch({
  executablePath,
  args: [...(sourceBuild ? [projectRoot] : []), ...(process.env.CI ? ["--disable-gpu"] : []), `--user-data-dir=${userData}`],
  env: electronEnvironment
});

try {
  const page = await application.firstWindow();
  await page.locator(".app-shell").waitFor({ timeout: 30_000 });
  const diagnostics = await page.evaluate(async () => ({
    title: document.title,
    apiSurface: {
      topLevel: Object.keys(window.workbench).sort(),
      migration: Object.keys(window.workbench.migration).sort(),
      files: Object.keys(window.workbench.files).sort(),
      github: Object.keys(window.workbench.github).sort(),
      references: Object.keys(window.workbench.references).sort()
    },
    vscode: await window.workbench.vscode.status(),
    toolchains: await window.workbench.toolchains.list(),
    projects: await window.workbench.library.list()
  }));
  const sqlite = join(userData, "library.sqlite");
  const sqliteBytes = (await stat(sqlite)).size;
  console.log(JSON.stringify({ userData, sqlite, sqliteBytes, ...diagnostics }, null, 2));
} finally {
  await application.close();
}
