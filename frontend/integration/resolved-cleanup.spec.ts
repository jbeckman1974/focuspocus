import { expect, test, type Page } from "@playwright/test";
import { task, taskId } from "../e2e/controls.ts";
import { signIn, submitCapture } from "./account.ts";

async function organizer(page: Page) {
  await page.getByRole("button", { name: "Organize…", exact: true }).click();
  return page.getByRole("dialog", { name: "Organize workspace" });
}

test("AT-01 · a filtered Inbox retains resolved work until Clean Up or removes it immediately", async ({
  page,
}) => {
  const held = "Checklist held until cleanup";
  const immediate = "Checklist removed immediately";
  await signIn(page, "neighbor");
  await submitCapture(page, [held, immediate].join("\n"));
  const original = await taskId(page, held);
  const availability = page.getByRole("combobox", { name: /^Availability/ });
  await availability.selectOption("remaining");
  const first = task(page, held);
  await first.getByRole("button", { name: `Complete ${held}`, exact: true }).click();
  await expect(first.getByRole("button", { name: `Reopen ${held}`, exact: true })).toBeVisible();
  let panel = await organizer(page);
  await expect(panel.getByRole("combobox", { name: /^Remove resolved rows/ })).toHaveValue("on-cleanup");
  await panel.getByRole("button", { name: "Clean Up Inbox", exact: true }).click();
  await expect(first).toHaveCount(0);
  panel = await organizer(page);
  await panel.getByRole("combobox", { name: /^Remove resolved rows/ }).selectOption("immediate");
  await expect(panel).not.toBeVisible();
  await task(page, immediate).getByRole("button", { name: `Complete ${immediate}`, exact: true }).click();
  await expect(task(page, immediate)).toHaveCount(0);
  await availability.selectOption("everything");
  await expect(first).toHaveAttribute("data-task-id", original);
  await expect(task(page, immediate).getByRole("button", { name: `Reopen ${immediate}`, exact: true })).toBeVisible();
});
