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
  const result = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/sharing/workspaces") &&
      r.request().method() === "POST" &&
      r.ok(),
  );
  await panel.getByLabel("Shared workspace name").fill(name);
  await panel
    .getByRole("button", { name: "Create shared workspace", exact: true })
    .click();
  const id = (await (await result).json()).workspaceId as string;
  await expect(
    page.getByRole("dialog", { name: "Workspace tools" }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Active workspace")).toHaveValue(id);
  await expect(page.getByRole("tree", { name: "Task outline" })).toBeVisible();
  return id;
}

export async function selectWorkspace(
  page: Page,
  id: string,
  select?: () => Promise<unknown>,
) {
  const picker = page.getByLabel("Active workspace");
  const snapshot = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/workspaces/" + id + "/snapshot") &&
      r.ok(),
  );
  if (select) await select();
  else await picker.selectOption(id);
  await snapshot;
  await expect(picker).toHaveValue(id);
  await expect(page.getByRole("tree", { name: "Task outline" })).toBeVisible();
}
