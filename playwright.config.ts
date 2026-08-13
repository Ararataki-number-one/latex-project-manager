import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChrome =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const webPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    launchOptions: existsSync(systemChrome) ? { executablePath: systemChrome } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `pnpm build:web && pnpm exec vite preview --config vite.web.config.ts --host 127.0.0.1 --port ${webPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
