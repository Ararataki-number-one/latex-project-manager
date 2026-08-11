import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChrome =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: existsSync(systemChrome) ? { executablePath: systemChrome } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm build:web && pnpm preview -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
