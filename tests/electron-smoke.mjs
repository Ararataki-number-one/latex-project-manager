import { mkdtemp, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron as electron } from "@playwright/test";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceBuild = process.env.ELECTRON_SMOKE_SOURCE === "1";
const executablePath = sourceBuild
  ? join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
  : join(projectRoot, "dist", "win-unpacked", "LaTeX 项目管理器.exe");
const userData = await mkdtemp(join(projectRoot, "test-results", "electron-smoke-"));
const application = await electron.launch({
  executablePath,
  args: [...(sourceBuild ? [projectRoot] : []), `--user-data-dir=${userData}`]
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
