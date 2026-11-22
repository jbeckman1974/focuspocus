import { expect, type Page, type Response } from "@playwright/test";
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
  return openNewWorkspace(page, () =>
    panel.getByRole("button", { name: "Create shared workspace" }).click(),
  );
}

export async function openNewWorkspace(page: Page, open: () => Promise<void>) {
  const picker = page.getByLabel("Active workspace");
  const selected = () =>
    picker.evaluateAll(
      (nodes) => (nodes[0] as HTMLSelectElement | undefined)?.value ?? "",
    );
  const previous = await selected();
  const opened = new Set<string>();
  const record = (response: Response) => {
    const path = new URL(response.url()).pathname;
    const match = /^\/api\/v1\/workspaces\/([^/]+)\/snapshot$/.exec(path);
    if (match && response.ok()) opened.add(match[1]);
  };
  page.on("response", record);
  try {
    await open();
    let id = "";
    await expect
      .poll(
        async () => {
          id = await selected();
          return id !== previous && opened.has(id);
        },
        { message: "A new workspace selection acknowledges its own snapshot" },
      )
      .toBe(true);
    expect(id).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    await expect(
      page.getByRole("tree", { name: "Task outline" }),
    ).toBeVisible();
    return id;
  } finally {
    page.off("response", record);
  }
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
