import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ??
    fileURLToPath(new URL("../build/browser-results/", import.meta.url)),
  forbidOnly: true,
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4173",
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
