import { expect, test } from "@playwright/test";
import { signIn } from "./account.ts";
import { task } from "../e2e/controls.ts";

test.use({
  viewport: { width: 320, height: 740 },
  hasTouch: true,
  isMobile: true,
});

test("AT-24 · the signed-in workspace keeps capture, workspace tools and inspection reachable by touch", async ({
  page,
}) => {
  await signIn(page, "planner");
  const menu = page.locator("summary", { hasText: "Workspace" });
  await menu.tap();
  await page
    .getByRole("button", { name: "Workspace tools…", exact: true })
    .tap();
  const dialog = page.getByRole("dialog", { name: "Workspace tools" });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 900, height: 740 });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).tap();
  await menu.tap();
  const title = "320-pixel field check";
  await page.getByRole("button", { name: "Add task", exact: true }).tap();
  await page.getByRole("textbox", { name: "Task titles" }).fill(title);
  await page.getByRole("button", { name: "Add tasks", exact: true }).tap();
  await task(page, title).tap();
  const inspect = page.getByRole("button", { name: "Inspector", exact: true });
  await inspect.tap();
  await expect(inspect).toHaveAttribute("aria-expanded", "true");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
