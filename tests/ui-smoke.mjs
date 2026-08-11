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

const probability = "概率方法笔记";
await projectRow(desktop, probability).getByRole("button", { name: `清理临时文件 ${probability}` }).click();
await desktop.getByRole("dialog", { name: "清理临时文件" }).waitFor();
await desktop.screenshot({ path: "test-results/ui-cleanup-dialog-desktop.png", fullPage: true });
await desktop.getByRole("dialog", { name: "清理临时文件" }).getByRole("button", { name: "关闭" }).click();

await projectRow(desktop, probability).getByRole("button", { name: `管理项目 ${probability}` }).click();
await desktop.getByRole("heading", { name: "项目介绍" }).waitFor();
await assertNoOverflow(desktop, "desktopIntroduction");
await desktop.screenshot({ path: "test-results/ui-introduction-desktop.png", fullPage: true });
await desktop.getByRole("tab", { name: /GitHub 同步/ }).click();
await desktop.getByRole("heading", { name: "GitHub 同步" }).waitFor();
await assertNoOverflow(desktop, "desktopGitHubSync");
await desktop.screenshot({ path: "test-results/ui-github-sync-desktop.png", fullPage: true });
await desktop.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "设置" }).click();
await desktop.getByRole("heading", { name: "设置" }).waitFor();
await assertNoOverflow(desktop, "desktopSettings");
await desktop.screenshot({ path: "test-results/ui-settings-desktop.png", fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto(previewUrl, { waitUntil: "networkidle" });
await mobile.getByRole("table", { name: "项目列表" }).waitFor();
await assertNoOverflow(mobile, "mobileLibrary");
await mobile.screenshot({ path: "test-results/ui-library-mobile.png", fullPage: true });
await projectRow(mobile, probability).getByRole("button", { name: `管理项目 ${probability}` }).click();
await mobile.getByRole("heading", { name: "项目介绍" }).waitFor();
await assertNoOverflow(mobile, "mobileIntroduction");
await mobile.screenshot({ path: "test-results/ui-introduction-mobile.png", fullPage: true });

await browser.close();
