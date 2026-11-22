import { expect, test, type Page } from "@playwright/test";
import { inspector, task } from "../e2e/controls.ts";
import { signIn, submitCapture, withProfile } from "./account.ts";
import { trustDevice, withDevice } from "./offline-device.ts";

async function noteFor(page: Page, title: string) {
  await task(page, title).getByText(title, { exact: true }).click();
  await inspector(page)
    .getByRole("button", { name: "Notes and files…" })
    .click();
  return page.getByRole("dialog", { name: "Notes and files" });
}

test("restored offline note drafts compare the original, local and current server text before reapply", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const title = "Compare the offline field note";
  const initial = "Initial observation";
  const remote = "Revised office observation";
  const local = "Offline crew observation";
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "neighbor");
    await submitCapture(page, title);
    const first = await noteFor(page, title);
    await first.getByRole("textbox", { name: "Note text" }).fill(initial);
    await first.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(first.getByRole("status")).toHaveText("Saved.");
    await first.getByRole("button", { name: "Close", exact: true }).click();
    await trustDevice(page);
    const editor = await noteFor(page, title);
    const note = editor.getByRole("textbox", { name: "Note text" });
    await expect(note).toHaveValue(initial);
    await device.connect(false);
    await note.fill(local);
    await editor
      .getByRole("button", { name: "Save note", exact: true })
      .click();
    await expect(editor).toContainText("Change saved on this device for sync.");
    const reopened = await device.restart(true);
    await reopened.goto("/app/");
    await expect(task(reopened, title)).toBeVisible();
    await withProfile(browser, "neighbor", async (second) => {
      const other = await noteFor(second, title);
      await other.getByRole("textbox", { name: "Note text" }).fill(remote);
      await other
        .getByRole("button", { name: "Save note", exact: true })
        .click();
      await expect(other.getByRole("status")).toHaveText("Saved.");
    });
    await device.connect(true);
    const changes = reopened.getByRole("region", { name: "Offline changes" });
    const compare = changes.getByRole("button", {
      name: "Compare note versions",
    });
    await expect(compare).toBeEnabled();
    const apply = changes.getByRole("button", { name: "Reapply change" });
    await expect(apply).toBeDisabled();
    await compare.click();
    for (const text of [initial, local, remote])
      await expect(changes.getByText(text, { exact: true })).toBeVisible();
    await apply.click();
    await expect(changes.getByRole("listitem")).toHaveCount(0);
    await withProfile(browser, "neighbor", async (second) => {
      await expect(
        (await noteFor(second, title)).getByRole("textbox", {
          name: "Note text",
        }),
      ).toHaveValue(local);
    });
  });
});
