import { expect, type Page } from "@playwright/test";
export async function toolsPanel(page: Page, section: string) {
  const dialog = page.getByRole("dialog", {
    name: "Workspace tools",
    exact: true,
  });
  if (!(await dialog.isVisible()))
    await page
      .getByRole("button", { name: "Workspace tools…", exact: true })
      .click();
  await dialog
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: section, exact: true })
    .click();
  return dialog.getByRole("region", { name: section, exact: true });
}
export async function closeTools(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Workspace tools",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
export async function createShared(page: Page, name: string) {
  const panel = await toolsPanel(page, "Sharing");
  await panel.getByLabel("Shared workspace name").fill(name);
  await panel
    .getByRole("button", { name: "Create shared workspace", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Workspace tools" }),
  ).not.toBeVisible();
  await expect(
    page.getByLabel("Active workspace").locator("option:checked"),
  ).toHaveText(name);
}
