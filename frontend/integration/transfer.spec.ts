import { expect, test } from "@playwright/test";
import { signIn } from "./account.ts";
import { closeTools, createShared, toolsPanel } from "./workspace-tools.ts";
import { task } from "../e2e/controls.ts";

test("AT-21/22 · preview import losses, retry one commit, restore a bundle and roll back the source", async ({
  page,
}) => {
  test.setTimeout(120000);
  await signIn(page, "planner");
  const name = "Portable field notes",
    title = "Check Café coordinates";
  await createShared(page, name);
  let panel = await toolsPanel(page, "Import");
  await panel.getByLabel("Source format").selectOption("csv");
  await panel.getByLabel("Source file").setInputFiles({
    name: "field.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Title,Notes,Unmapped column\n"' +
        title +
        '","Line one\nLine two",value\n',
    ),
  });
  await panel.getByRole("button", { name: "Preview import" }).click();
  await expect(
    panel.getByRole("region", { name: "Import comparison" }),
  ).toContainText(/unmapped column/i);
  const attempts: string[] = [];
  await page.route(/\/imports\/[a-f0-9-]+\/commit$/, async (route) => {
    attempts.push(route.request().postDataJSON().operationId);
    if (attempts.length > 1) return route.continue();
    expect((await route.fetch()).status()).toBe(200);
    return route.abort("connectionreset");
  });
  await panel.getByRole("button", { name: "Commit import" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "Commit import" }).click();
  await expect(panel.getByRole("status")).toContainText("committed");
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
  await closeTools(page);
  await expect(task(page, title)).toBeVisible();
  panel = await toolsPanel(page, "Export");
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download workspace bundle" })
    .click();
  const zip = await (await download).path();
  expect(zip).toBeTruthy();
  await panel
    .getByLabel("Workspace bundle", { exact: true })
    .setInputFiles(zip!);
  await panel
    .getByRole("button", { name: "Restore bundle", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Created a new workspace",
  );
  await panel.getByRole("button", { name: "Open restored workspace" }).click();
  await expect(task(page, title)).toBeVisible();
  await page.getByLabel("Active workspace").selectOption({ label: name });
  panel = await toolsPanel(page, "Import");
  await panel.getByLabel("Previous imports").selectOption({ index: 1 });
  await panel.getByRole("button", { name: "Roll back import…" }).click();
  await panel.getByRole("button", { name: "Confirm rollback" }).click();
  await expect(panel.getByRole("status")).toContainText("rolled_back");
  await closeTools(page);
  await expect(task(page, title)).toHaveCount(0);
});
