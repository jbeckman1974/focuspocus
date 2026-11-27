import { defineConfig } from "@playwright/test";

const engines = ["chromium", "firefox", "webkit"] as const;

export default defineConfig({
  testDir: "..",
  testMatch: ["**/accessibility/*.spec.ts", "**/reconciliation.spec.ts"],
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/focuspocus-accessibility",
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 75_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8000",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: engines.map((browserName) => ({
    name: browserName,
    use: { browserName },
  })),
});
