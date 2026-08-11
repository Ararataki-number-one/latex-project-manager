import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const previewUrl = process.env.LATEX_MANAGER_PREVIEW_URL ?? "http://127.0.0.1:4174/";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {})
});

function projectRow(page, name) {
  return page.locator(".project-row").filter({ has: page.getByRole("button", { name, exact: true }) });
}

async function assertNoOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  if (widths.document > widths.viewport || widths.body > widths.viewport) {
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(widths)}`);
  }
  process.stdout.write(`${label}=${JSON.stringify(widths)}\n`);
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await desktop.goto(previewUrl, { waitUntil: "networkidle" });
await desktop.getByRole("table", { name: "项目列表" }).waitFor();
await assertNoOverflow(desktop, "desktopLibrary");
await desktop.screenshot({ path: "test-results/ui-library-desktop.png", fullPage: true });

await desktop.getByRole("button", { name: "导入项目" }).click();
const desktopImport = desktop.getByRole("dialog", { name: "导入 LaTeX 项目" });
await desktopImport.getByRole("button", { name: "选择目录" }).click();
await desktopImport.locator(".candidate").first().click();
await assertNoOverflow(desktop, "desktopImport");
await desktop.screenshot({ path: "test-results/ui-import-desktop.png", fullPage: true });
await desktopImport.getByRole("button", { name: "关闭" }).click();

await desktop.getByRole("button", { name: "开始" }).click();
const desktopOnboarding = desktop.getByRole("dialog", { name: "配置 LaTeX 项目管理器" });
await desktopOnboarding.waitFor();
await assertNoOverflow(desktop, "desktopOnboarding");
await desktop.screenshot({ path: "test-results/ui-onboarding-desktop.png", fullPage: true });
await desktopOnboarding.getByRole("button", { name: "暂时关闭新手引导" }).click();

const probability = "概率方法笔记";
await projectRow(desktop, probability).getByRole("button", { name: `更多操作 ${probability}` }).click();
await desktop.getByRole("dialog", { name: `项目操作 ${probability}` }).waitFor();
await desktop.screenshot({ path: "test-results/ui-project-menu-desktop.png", fullPage: true });
await projectRow(desktop, probability).getByRole("button", { name: `清理临时文件 ${probability}` }).click();
await desktop.getByRole("dialog", { name: "清理临时文件" }).waitFor();
await desktop.screenshot({ path: "test-results/ui-cleanup-dialog-desktop.png", fullPage: true });
await desktop.getByRole("dialog", { name: "清理临时文件" }).getByRole("button", { name: "关闭" }).click();

await projectRow(desktop, probability).getByRole("button", { name: `管理项目 ${probability}` }).click();
await desktop.getByRole("heading", { name: "项目介绍" }).waitFor();
await assertNoOverflow(desktop, "desktopIntroduction");
await desktop.screenshot({ path: "test-results/ui-introduction-desktop.png", fullPage: true });
await desktop.getByRole("tab", { name: "同步", exact: true }).click();
await desktop.getByRole("heading", { name: "GitHub 同步" }).waitFor();
await assertNoOverflow(desktop, "desktopGitHubSync");
await desktop.screenshot({ path: "test-results/ui-github-sync-desktop.png", fullPage: true });
await desktop.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "设置" }).click();
await desktop.getByRole("heading", { name: "设置" }).waitFor();
await assertNoOverflow(desktop, "desktopSettings");
await desktop.screenshot({ path: "test-results/ui-settings-desktop.png", fullPage: true });
await desktop.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "同步中心" }).click();
await desktop.getByRole("heading", { name: "同步中心" }).waitFor();
await assertNoOverflow(desktop, "desktopSyncCenter");
await desktop.screenshot({ path: "test-results/ui-sync-center-desktop.png", fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto(previewUrl, { waitUntil: "networkidle" });
await mobile.getByRole("table", { name: "项目列表" }).waitFor();
await assertNoOverflow(mobile, "mobileLibrary");
await mobile.screenshot({ path: "test-results/ui-library-mobile.png", fullPage: true });
await mobile.getByRole("button", { name: "导入项目" }).click();
const mobileImport = mobile.getByRole("dialog", { name: "导入 LaTeX 项目" });
await mobileImport.waitFor();
await assertNoOverflow(mobile, "mobileImport");
await mobile.screenshot({ path: "test-results/ui-import-mobile.png", fullPage: true });
await mobileImport.getByRole("button", { name: "关闭" }).click();
const mobileMenuTrigger = projectRow(mobile, probability).getByRole("button", { name: `更多操作 ${probability}` });
await mobileMenuTrigger.click();
const mobileProjectMenu = mobile.getByRole("dialog", { name: `项目操作 ${probability}` });
await mobileProjectMenu.waitFor();
await assertNoOverflow(mobile, "mobileProjectMenu");
await mobile.screenshot({ path: "test-results/ui-project-menu-mobile.png", fullPage: true });
await mobile.keyboard.press("Escape");
await mobileProjectMenu.waitFor({ state: "hidden" });
await projectRow(mobile, probability).getByRole("button", { name: `管理项目 ${probability}` }).click();
await mobile.getByRole("heading", { name: "项目介绍" }).waitFor();
await assertNoOverflow(mobile, "mobileIntroduction");
await mobile.screenshot({ path: "test-results/ui-introduction-mobile.png", fullPage: true });
await mobile.getByRole("button", { name: "打开侧栏" }).click();
await mobile.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "同步中心" }).click();
await mobile.locator(".app-shell.nav-closed").waitFor();
await mobile.waitForTimeout(180);
await mobile.getByRole("heading", { name: "同步中心" }).waitFor();
await assertNoOverflow(mobile, "mobileSyncCenter");
await mobile.screenshot({ path: "test-results/ui-sync-center-mobile.png", fullPage: true });
await mobile.getByRole("button", { name: "打开侧栏" }).click();
await mobile.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "设置" }).click();
await mobile.locator(".app-shell.nav-closed").waitFor();
await mobile.waitForTimeout(180);
await mobile.getByRole("heading", { name: "设置" }).waitFor();
await assertNoOverflow(mobile, "mobileSettings");
await mobile.screenshot({ path: "test-results/ui-settings-mobile.png", fullPage: true });

const dark = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 1 });
await dark.goto(previewUrl, { waitUntil: "networkidle" });
await dark.getByRole("table", { name: "项目列表" }).waitFor();
await assertNoOverflow(dark, "darkLibrary");
await dark.screenshot({ path: "test-results/ui-library-dark.png", fullPage: true });
await dark.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "设置" }).click();
await dark.getByRole("heading", { name: "设置" }).waitFor();
await dark.screenshot({ path: "test-results/ui-settings-dark.png", fullPage: true });

await browser.close();
