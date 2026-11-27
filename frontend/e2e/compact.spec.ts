import { expect, test } from "@playwright/test";
import { inspector, sidebarDestination, task } from "./controls.ts";

test.use({ viewport: { width: 320, height: 780 } });

test("AT-24 and AT-28 · edit and use preferences at a 320px width", async ({
  page,
}) => {
  await page.goto("/");
  const browse = page.getByRole("button", { name: "Browse", exact: true });
  const preferences = page.getByRole("button", {
    name: "Preferences",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Workspace preferences" });
  await browse.click();
  await preferences.click();
  await dialog
    .getByRole("combobox", { name: /^Theme\b/ })
    .selectOption({ label: "Dark" });
  await dialog
    .getByRole("combobox", { name: /^Row density\b/ })
    .selectOption({ label: "Compact" });
  await dialog
    .getByRole("combobox", { name: /^Text size\b/ })
    .selectOption({ label: "Large" });
  await dialog
    .getByRole("combobox", { name: /^Edit titles in\b/ })
    .selectOption({ label: "Inspector" });
  await dialog.getByRole("button", { name: "Close preferences" }).click();
  await expect(dialog).toBeHidden();

  if (!(await sidebarDestination(page, "Punch list").isVisible())) {
    await browse.click();
  }
  await sidebarDestination(page, "Punch list").click();
  const tree = page.getByRole("tree", { name: "Task outline" });
  await expect(tree).toBeVisible();
  await expect(tree).toHaveCSS("color-scheme", "dark");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Task titles" });
  await expect(composer).toHaveAttribute("placeholder", /Punch list/);
  await composer.fill("Narrow screen task");
  await page.getByRole("button", { name: "Add tasks", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Punch list", exact: true }),
  ).toBeVisible();
  const row = task(page, "Narrow screen task");
  await row.getByText("Narrow screen task", { exact: true }).click();
  const showInspector = page.getByRole("button", {
    name: "Inspector",
    exact: true,
  });
  await showInspector.click();
  const panel = inspector(page);
  const title = panel.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toHaveValue("Narrow screen task");
  await title.fill("Edited in inspector");
  await panel.getByRole("button", { name: "Apply title" }).click();
  await panel.getByRole("button", { name: "Close inspector" }).click();
  await expect(task(page, "Edited in inspector")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(
    hasHorizontalOverflow,
    "320px outline fits the viewport with large text",
  ).toBe(false);

  await browse.click();
  await preferences.click();
  for (const [setting, selected] of [
    ["Theme", "Dark"],
    ["Row density", "Compact"],
    ["Text size", "Large"],
    ["Edit titles in", "Inspector"],
  ]) {
    await expect(
      dialog
        .getByRole("combobox", { name: new RegExp(`^${setting}\\b`) })
        .locator("option:checked"),
    ).toHaveText(selected);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
