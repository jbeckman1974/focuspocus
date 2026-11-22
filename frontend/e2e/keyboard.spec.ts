import { expect, test } from "@playwright/test";
import {
  activate,
  chooseWithKeys,
  inspector,
  selectTaskWithKeys,
  sidebarDestination,
  tabTo,
  task,
  taskId,
} from "./controls.ts";

test("AT-01 and AT-16 · organize, find and undo using the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Task outline" });
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await tabTo(page, capture);
  await page.keyboard.insertText("Bench kit");
  await page.keyboard.press("Enter");
  await expect(capture).toHaveValue("");
  await tabTo(page, capture);
  await page.keyboard.insertText("Cable roll\nField book");
  await page.keyboard.press("Enter");
  const benchId = await taskId(page, "Bench kit");
  const cableId = await taskId(page, "Cable roll");
  const bookId = await taskId(page, "Field book");
  expect(new Set([benchId, cableId, bookId]).size).toBe(3);

  await selectTaskWithKeys(page, "Cable roll");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(task(page, "Field book")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(task(page, "Cable roll")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("i");
  await expect(task(page, "Field book")).toHaveAttribute("aria-level", "2");
  await expect(task(page, "Cable roll")).toHaveAttribute("aria-level", "2");

  if (!(await inspector(page).isVisible())) {
    await activate(
      page,
      page.getByRole("button", { name: "Inspector", exact: true }),
    );
  }
  const field = inspector(page).getByRole("checkbox", {
    name: "Field",
    exact: true,
  });
  await tabTo(page, field);
  await page.keyboard.press("Space");
  await expect(field).toBeChecked();

  await selectTaskWithKeys(page, "Field book");
  await page.keyboard.press("F2");
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await expect(title).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Discard this edit");
  await page.keyboard.press("Escape");
  await expect(task(page, "Field book")).toHaveAttribute(
    "data-task-id",
    bookId,
  );
  await expect(tree).toBeFocused();
  await page.keyboard.press("F2");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Field book revised");
  await page.keyboard.press("Enter");
  await expect(task(page, "Field book revised")).toHaveAttribute(
    "data-task-id",
    bookId,
  );

  const due = inspector(page).getByLabel("Due date", { exact: true });
  await tabTo(page, due);
  // Chromium's en-US date editor advances from month to day to year.
  await page.keyboard.type("11252026");
  await expect(due).toHaveValue("2026-11-25");
  await activate(
    page,
    inspector(page).getByRole("button", { name: "Apply date" }),
  );

  await selectTaskWithKeys(page, "Bench kit");
  await page.keyboard.press("ArrowLeft");
  await expect(task(page, "Cable roll")).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(task(page, "Cable roll")).toHaveAttribute(
    "data-task-id",
    cableId,
  );
  await page.keyboard.press("m");
  const move = page.getByRole("dialog", { name: "Move tasks" });
  await chooseWithKeys(
    page,
    move.getByRole("combobox", { name: /^Move to\b/ }),
    "Punch list",
  );
  await activate(
    page,
    move.getByRole("button", { name: "Move tasks", exact: true }),
  );
  await expect(move).toBeHidden();

  await activate(page, sidebarDestination(page, "Field"));
  await expect(task(page, "Cable roll")).toHaveAttribute(
    "data-task-id",
    cableId,
  );
  await expect(task(page, "Field book revised")).toHaveAttribute(
    "data-task-id",
    bookId,
  );
  await selectTaskWithKeys(page, "Field book revised");
  await expect(due).toHaveValue("2026-11-25");
  await activate(page, sidebarDestination(page, "Punch list"));
  const bench = task(page, "Bench kit");
  await expect(bench).toHaveAttribute("data-task-id", benchId);
  await selectTaskWithKeys(page, "Bench kit");
  await page.keyboard.press("x");
  await expect(
    bench.getByRole("button", { name: "Reopen Bench kit" }),
  ).toBeVisible();
  await page.keyboard.press("u");
  await expect(
    bench.getByRole("button", { name: "Complete Bench kit" }),
  ).toBeVisible();
  await page.keyboard.press("Shift+U");
  await expect(
    bench.getByRole("button", { name: "Reopen Bench kit" }),
  ).toBeVisible();
  await expect(task(page, "Field book revised")).toHaveAttribute(
    "data-task-id",
    bookId,
  );
  await expect(tree).toBeFocused();
});
