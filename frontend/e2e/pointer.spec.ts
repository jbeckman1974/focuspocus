import { expect, test } from "@playwright/test";
import { inspector, sidebarDestination, task, taskId } from "./controls.ts";

test("AT-01 and AT-16 · organize, find and undo with pointer controls", async ({
  page,
}) => {
  await page.goto("/");
  const capture = page.getByRole("textbox", { name: "Task titles" });
  const submit = page.getByRole("button", { name: "Add tasks", exact: true });
  await capture.fill("Bench kit");
  await submit.click();
  await capture.fill("Cable roll\nField book");
  await submit.click();
  const benchId = await taskId(page, "Bench kit");
  const cableId = await taskId(page, "Cable roll");
  const bookId = await taskId(page, "Field book");

  const cable = task(page, "Cable roll");
  const book = task(page, "Field book");
  await cable.getByText("Cable roll", { exact: true }).click();
  const multiple = page.getByRole("button", { name: "Select multiple" });
  await multiple.click();
  await book.getByText("Field book", { exact: true }).click();
  await expect(cable).toHaveAttribute("aria-selected", "true");
  await expect(book).toHaveAttribute("aria-selected", "true");
  const commands = page.getByRole("button", { name: "Outline commands" });
  await commands.click();
  await page.getByRole("button", { name: "Indent", exact: true }).click();
  await expect(book).toHaveAttribute("aria-level", "2");
  await expect(cable).toHaveAttribute("aria-level", "2");

  if (!(await inspector(page).isVisible())) {
    await page.getByRole("button", { name: "Inspector", exact: true }).click();
  }
  const field = inspector(page).getByRole("checkbox", {
    name: "Field",
    exact: true,
  });
  await field.check();
  await expect(field).toBeChecked();
  await multiple.click();
  await cable.getByText("Cable roll", { exact: true }).dblclick();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Cable reel");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(task(page, "Cable reel")).toHaveAttribute(
    "data-task-id",
    cableId,
  );

  await book.getByText("Field book", { exact: true }).click();
  const due = inspector(page).getByLabel("Due date", { exact: true });
  await due.fill("2026-11-26");
  await inspector(page).getByRole("button", { name: "Apply date" }).click();
  const bench = task(page, "Bench kit");
  await bench.getByRole("button", { name: "Collapse Bench kit" }).click();
  await expect(book).toBeHidden();
  await bench.getByRole("button", { name: "Expand Bench kit" }).click();
  await expect(book).toHaveAttribute("data-task-id", bookId);

  const benchTitle = bench.getByText("Bench kit", { exact: true });
  await benchTitle.click();
  const start = await benchTitle.boundingBox();
  if (!start) throw new Error("The selected group has no visible drag surface");
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 14, y, { steps: 5 });
    const destination = page
      .getByLabel("Move dragged tasks", { exact: true })
      .getByText("Punch list", { exact: true });
    await expect(destination).toBeVisible();
    const target = await destination.boundingBox();
    if (!target) throw new Error("The destination has no visible drop area");
    const center = target.x + target.width / 2;
    const middle = target.y + target.height / 2;
    await page.mouse.move(center, middle, { steps: 10 });
    await page.mouse.move(center + 1, middle);
  } finally {
    await page.mouse.up();
  }

  await sidebarDestination(page, "Field").click();
  await expect(task(page, "Cable reel")).toHaveAttribute(
    "data-task-id",
    cableId,
  );
  await expect(book).toHaveAttribute("data-task-id", bookId);
  await book.getByText("Field book", { exact: true }).click();
  await expect(due).toHaveValue("2026-11-26");
  await sidebarDestination(page, "Punch list").click();
  await expect(bench).toHaveAttribute("data-task-id", benchId);
  await bench.getByRole("button", { name: "Complete Bench kit" }).click();
  await expect(
    bench.getByRole("button", { name: "Reopen Bench kit" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    bench.getByRole("button", { name: "Complete Bench kit" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(
    bench.getByRole("button", { name: "Reopen Bench kit" }),
  ).toBeVisible();
  await expect(book).toHaveAttribute("data-task-id", bookId);
});
