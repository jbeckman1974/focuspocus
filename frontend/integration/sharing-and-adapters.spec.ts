import { expect, test } from "@playwright/test";
import { signIn, submitCapture } from "./account.ts";
import { task } from "../e2e/controls.ts";
import { closeTools, createShared, toolsPanel } from "./workspace-tools.ts";

test("AT-17/26/29 · invite a viewer, keep reminders personal, promote and revoke access", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:8000" });
  try {
    const guest = await other.newPage();
    await signIn(page, "owner");
    await signIn(guest, "neighbor");
    const username = await guest.evaluate(
      async () =>
        (await (await fetch("/api/v1/session")).json()).user.username as string,
    );
    const name = "Shared observation book",
      title = "Check north monument";
    await createShared(page, name);
    await submitCapture(page, title);
    await expect(task(page, title)).toBeVisible();
    let panel = await toolsPanel(page, "Sharing");
    await panel.getByLabel("Invite account").fill(username);
    await panel.getByLabel("Invitation role").selectOption("viewer");
    await panel.getByRole("button", { name: "Create invitation" }).click();
    const code = await panel
      .getByLabel("New invitation code", { exact: true })
      .inputValue();
    const guestPanel = await toolsPanel(guest, "Sharing");
    await guestPanel.getByLabel("Invitation code", { exact: true }).fill(code);
    await guestPanel.getByRole("button", { name: "Accept invitation" }).click();
    await expect(task(guest, title)).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "New project", exact: true }),
    ).toBeDisabled();
    const reminders = await toolsPanel(guest, "Reminders");
    await reminders.getByLabel("Reminder task").selectOption({ label: title });
    await reminders.getByLabel(/Remind me at/).fill("2028-02-11T08:20");
    await reminders.getByRole("button", { name: "Add reminder" }).click();
    await expect(
      reminders.getByRole("listitem").filter({ hasText: title }),
    ).toBeVisible();
    await closeTools(guest);
    const mine = await toolsPanel(page, "Reminders");
    await expect(
      mine.getByRole("group", { name: "Notifications on this browser" }),
    ).toBeVisible();
    await expect(
      mine.getByRole("listitem").filter({ hasText: title }),
    ).toHaveCount(0);
    panel = await toolsPanel(page, "Sharing");
    await panel.getByLabel("Role for " + username).selectOption("editor");
    await expect(
      guest.getByRole("button", { name: "New project", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await panel
      .getByRole("button", { name: "Remove " + username, exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Confirm removal", exact: true })
      .click();
    await expect(task(guest, title)).toHaveCount(0, { timeout: 15000 });
  } finally {
    await other.close();
  }
});
