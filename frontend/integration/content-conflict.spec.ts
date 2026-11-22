import { expect, test } from "@playwright/test";
import { inspector, task } from "../e2e/controls.ts";
import { signIn, submitCapture, withProfile } from "./account.ts";

test("a note draft survives a failed conflict comparison until access is verified", async ({
  page, browser,
}) => {
  const title = "Note comparison fixture";
  const draft = "Draft from the first browser";
  const update = "Saved in a second browser";
  await signIn(page, "neighbor");
  await submitCapture(page, title);
  await task(page, title).getByText(title, { exact: true }).click();
  await inspector(page).getByRole("button", { name: "Notes and files…" }).click();
  const dialog = page.getByRole("dialog", { name: "Notes and files" });
  const note = dialog.getByRole("textbox", { name: "Note text" });
  await note.fill(draft);

  await withProfile(browser, "neighbor", async (second) => {
    await task(second, title).getByText(title, { exact: true }).click();
    await inspector(second).getByRole("button", { name: "Notes and files…" }).click();
    const editor = second.getByRole("dialog", { name: "Notes and files" });
    await editor.getByRole("textbox", { name: "Note text" }).fill(update);
    await editor.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText("Saved.");
  });
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  const compare = dialog.getByRole("button", { name: "Compare latest version" });
  await expect(compare).toBeVisible();
  const metadata = /\/content\/items\/[^/]+$/;
  await page.route(metadata, (route) => route.abort("failed"), { times: 1 });
  await compare.click();
  await expect(note).toHaveCount(0);
  await dialog.getByRole("button", { name: "Verify access" }).click();
  await expect(note).toHaveValue(draft);
  await compare.click();
  const saved = dialog.getByText("Saved note for comparison", { exact: true });
  await saved.click();
  await expect(dialog.locator("details")).toContainText(update);
  await expect(note.first()).toHaveValue(draft);
});
