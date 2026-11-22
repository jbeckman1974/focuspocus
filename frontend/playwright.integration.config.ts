import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./integration",
  // The recovery harness supplies a second web process backed by a fenced SQL restore.
  testIgnore: process.env.FOCUSPOCUS_QA_RESTORE_HOST
    ? []
    : ["**/offline-restore.spec.ts"],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/focuspocus-integration",
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8000",
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
    // Login requests, cookies and write contexts belong only to this test run.
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
