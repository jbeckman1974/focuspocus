import { expect, test } from "@playwright/test";

test("Workspace controls follow the system theme and return keyboard focus to Preferences", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toolbar = page.getByRole("toolbar", { name: "Workspace actions" });
  const add = toolbar.getByRole("button", { name: "Add task" });
  await add.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    toolbar.getByRole("button", { name: "Inspector" }),
  ).toBeFocused();

  const preferences = page.getByRole("button", {
    name: "Preferences",
    exact: true,
  });
  await preferences.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Workspace preferences" });
  const theme = dialog.getByRole("combobox", { name: "Theme", exact: true });
  await expect(theme).toHaveValue("system");
  const surfaceColor = () =>
    dialog.evaluate((surface) => getComputedStyle(surface).backgroundColor);
  const light = await surfaceColor();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(surfaceColor).not.toBe(light);
  await theme.selectOption("light");
  await expect.poll(surfaceColor).toBe(light);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(preferences).toBeFocused();

  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(preferences).toBeFocused();
});
