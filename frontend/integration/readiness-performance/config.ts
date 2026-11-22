import { defineConfig } from "@playwright/test";
import integration from "../../playwright.integration.config.ts";

export default defineConfig({
  ...integration,
  testDir: ".",
  testIgnore: [],
  testMatch: "**/*.bench.ts",
  expect: { timeout: 90_000 },
  timeout: 30 * 60_000,
  reporter: "line",
});
