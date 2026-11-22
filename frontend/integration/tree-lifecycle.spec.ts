import { expect, test, type Page } from "@playwright/test";
import { sidebarDestination, taskId } from "../e2e/controls.ts";
import { createDestination, signIn, submitCapture } from "./account.ts";

async function openOrganizer(page: Page) {
  await page.getByRole("button", { name: "Organize…", exact: true }).click();
  return page.getByRole("dialog", { name: "Organize workspace" });
}

test("AT-27 · duplicate and restore a nested group with stable original IDs", async ({
  page,
}) => {
  await signIn(page, "owner");
  const project = "AT-27 Control traverse";
  const groupTitle = "G01 Tie shots";
  const childTitle = "A03 East tie";
  await createDestination(page, "project", project);
  await sidebarDestination(page, project).click();
  await submitCapture(page, `${groupTitle}\n${childTitle}`);
  const groupId = await taskId(page, groupTitle);
  const childId = await taskId(page, childTitle);
  const rows = page.getByRole("tree", { name: "Task outline" }).getByRole("treeitem");
  const group = rows.and(page.locator(`[data-task-id="${groupId}"]`));
  const child = rows.and(page.locator(`[data-task-id="${childId}"]`));
  await child.getByText(childTitle, { exact: true }).click();
  await page.getByRole("button", { name: "Outline commands" }).click();
  await page.getByRole("button", { name: "Indent", exact: true }).click();
  await expect(child).toHaveAttribute("aria-level", "2");
  await group.getByText(groupTitle, { exact: true }).click();
  const duplicate = await openOrganizer(page);
  await duplicate.getByRole("button", { name: "Duplicate selection", exact: true }).click();
  await expect(rows).toHaveCount(4);
  const visibleIds = () =>
    rows.evaluateAll((elements) => elements.map((row) => row.getAttribute("data-task-id")));
  const bothTrees = await visibleIds();
  expect(new Set(bothTrees).size).toBe(4);
  const copyIds = bothTrees.filter((id) => id !== groupId && id !== childId);
  await group.getByText(groupTitle, { exact: true }).click();
  const remove = await openOrganizer(page);
  await remove.getByRole("button", { name: "Move to Trash", exact: true }).click();
  await expect.poll(visibleIds).toEqual(copyIds);
  const restore = await openOrganizer(page);
  await restore.getByRole("button", { name: "Trash", exact: true }).click();
  await restore.getByRole("button", { name: `Restore ${groupTitle}`, exact: true }).click();
  await expect.poll(visibleIds).toEqual(bothTrees);
  await expect(child).toHaveAttribute("aria-level", "2");
});
