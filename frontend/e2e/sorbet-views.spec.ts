import { expect, test } from "@playwright/test";

test("Sorbet shares task identity, progress and keyboard focus between Board, List and Calendar", async ({
  page,
}) => {
  await page.goto("/sample/?demo=offsite#board");
  const layouts = page.getByRole("group", { name: "Task view" });
  const board = page.getByRole("region", { name: "Task board" });
  const lane = (name: string) =>
    board.getByRole("region", { name, exact: true });
  await expect(layouts.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    lane("In progress").getByRole("button", {
      name: "Book the venue",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await lane("In progress")
    .getByRole("button", { name: "Return to Next" })
    .click();
  const venue = lane("Next").getByRole("button", {
    name: "Book the venue",
    exact: true,
  });
  await expect(venue).toBeFocused();
  await lane("Next").getByRole("button", { name: "Start task" }).click();
  await expect(
    lane("In progress").getByRole("button", {
      name: "Book the venue",
      exact: true,
    }),
  ).toBeFocused();
  await lane("In progress")
    .getByRole("button", { name: "Complete Book the venue", exact: true })
    .click();
  await expect(lane("Done").locator('[data-task-id="venue"]')).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    lane("In progress").locator('[data-task-id="venue"]'),
  ).toBeVisible();
  await layouts.getByRole("button", { name: "Board" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("treeitem", { name: "Book the venue", exact: true }),
  ).toHaveAttribute("data-task-id", "venue");
  await page.keyboard.press("End");
  const agenda = page.getByRole("region", { name: "Selected day agenda" });
  await expect(
    agenda.getByRole("button", { name: "Book the venue" }),
  ).toHaveAttribute("data-task-id", "venue");
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await agenda.getByRole("button", { name: "Book the venue" }).click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Book the venue");
  await layouts.getByRole("button", { name: "Board" }).click();
  await lane("Next")
    .getByRole("button", { name: "Add task to Team offsite" })
    .click();
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await expect(capture).toBeFocused();
  await capture.fill("Send menu options");
  await capture.press("Enter");
  await expect(
    lane("Next").getByRole("button", {
      name: "Send menu options",
      exact: true,
    }),
  ).toBeVisible();
  await capture.press("Escape");
  await expect(capture).toBeHidden();
  await layouts.getByRole("button", { name: "Calendar" }).click();
  await expect(
    page.getByRole("button", { name: "No due date" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Send menu options", exact: true }),
  ).toBeVisible();
});

test("Sorbet adapts its board and calendar to a narrow window and saved theme choices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/sample/?demo=offsite#board");
  const next = page.getByRole("region", { name: "Next", exact: true });
  const color = () =>
    next.evaluate((el) => getComputedStyle(el).backgroundColor);
  const light = await color();
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace preferences" });
  await dialog
    .getByRole("combobox", { name: "Theme", exact: true })
    .selectOption("dark");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect.poll(color).not.toBe(light);
  await expect(page.locator(".fp-shell")).toHaveCSS("color-scheme", "dark");
  await expect(
    next.getByRole("button", { name: "Draft the agenda", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Task view" })
    .getByRole("button", { name: "Calendar" })
    .click();
  await expect(page.getByRole("grid")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
