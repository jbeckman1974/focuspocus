import { expect, type Locator, type Page } from "@playwright/test";

export function task(page: Page, title: string) {
  return page
    .getByRole("tree", { name: "Task outline" })
    .getByRole("treeitem", { name: title, exact: true });
}

export function sidebarDestination(page: Page, title: string) {
  return page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: title, exact: true });
}

export function inspector(page: Page) {
  return page.getByRole("complementary", { name: "Task inspector" });
}

export async function taskId(page: Page, title: string): Promise<string> {
  const row = task(page, title);
  await expect(row).toHaveAttribute("data-task-id", /.+/);
  return (await row.getAttribute("data-task-id"))!;
}

// Reach controls through the user's tab order, including dialog focus traps.
export async function tabTo(page: Page, target: Locator) {
  await page.bringToFront();
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let stops = 0; stops < 100; stops++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target, "Reachable with the Tab key").toBeFocused({
    timeout: 1000,
  });
}

export async function activate(page: Page, control: Locator) {
  await tabTo(page, control);
  await page.keyboard.press("Enter");
}

export async function selectTaskWithKeys(page: Page, title: string) {
  const tree = page.getByRole("tree", { name: "Task outline" });
  const row = task(page, title);
  await expect(row).toBeAttached();
  const id = await row.getAttribute("id");
  expect(id, "An active tree row has a DOM identity").toBeTruthy();
  await tabTo(page, tree);
  await page.keyboard.press("Home");
  const count = await tree.getByRole("treeitem").count();
  for (let index = 0; index < count; index++) {
    if ((await tree.getAttribute("aria-activedescendant")) === id) {
      await expect(row).toHaveAttribute("aria-selected", "true");
      return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`Keyboard navigation could not reach task "${title}"`);
}

export async function chooseWithKeys(
  page: Page,
  select: Locator,
  label: string,
) {
  const option = select.getByRole("option", {
    name: label,
    exact: true,
    includeHidden: true,
  });
  const value = await option.getAttribute("value");
  expect(value).not.toBeNull();
  await tabTo(page, select);
  await page.keyboard.press("Home");
  const count = await select
    .getByRole("option", { includeHidden: true })
    .count();
  for (let index = 0; index < count; index++) {
    if ((await select.inputValue()) === value) return;
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`Keyboard navigation could not choose "${label}"`);
}
