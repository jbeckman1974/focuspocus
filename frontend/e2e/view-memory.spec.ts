import { expect, test, type Locator } from "@playwright/test";
import { inspector, sidebarDestination, tabTo, task, taskId } from "./controls.ts";

function visibleAnchor(tree: Locator) {
  return tree.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = Array.from(element.querySelectorAll("[data-task-id]")).find(
      (node) => node.getBoundingClientRect().bottom > top,
    );
    return { id: row?.getAttribute("data-task-id"), top: element.scrollTop };
  });
}

test("AT-24 · reveal the newly captured active row when the keyboard enters the outline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 640 });
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Task outline" });
  const composer = page.getByRole("textbox", { name: "Task titles" });
  await task(page, "Loose receipt").getByText("Loose receipt", { exact: true }).click();
  const predecessor = await tree.getByRole("treeitem").last().getAttribute("data-task-id");
  expect(predecessor).toBeTruthy();
  const before = await visibleAnchor(tree);
  expect(before.top).toBeLessThanOrEqual(1);

  const title = "Captured below the fold";
  await composer.fill(title);
  await composer.press("Enter");
  await expect(composer).toBeFocused();
  const id = await taskId(page, title);
  await page.keyboard.insertText("Next capture draft");
  await expect(composer).toHaveValue("Next capture draft");
  expect(await visibleAnchor(tree)).toEqual(before);
  expect(
    await task(page, title).evaluate((row) => {
      const viewport = row.closest('[role="tree"]')!.getBoundingClientRect();
      return row.getBoundingClientRect().top >= viewport.bottom;
    }),
  ).toBe(true);

  await tabTo(page, tree);
  await expect(tree).toBeFocused();
  await expect.poll(() =>
    tree.evaluate((element) => {
      const row = document.getElementById(element.getAttribute("aria-activedescendant") ?? "");
      const bounds = row?.getBoundingClientRect();
      const viewport = element.getBoundingClientRect();
      return {
        id: row?.getAttribute("data-task-id"),
        visible: !!bounds && bounds.top >= viewport.top - 1 && bounds.bottom <= viewport.bottom + 1,
      };
    }),
  ).toEqual({ id, visible: true });
  await expect(composer).toHaveValue("Next capture draft");
  await page.keyboard.press("Shift+ArrowUp");
  const selected = tree.getByRole("treeitem", { selected: true });
  await expect(selected).toHaveCount(2);
  expect(
    await selected.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-id"))),
  ).toEqual([predecessor, id]);
});

test("AT-16 and AT-24 · an empty selection preserves the cursor and leaves tasks unchanged", async ({
  page,
}) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Task outline" });
  const selected = tree.getByRole("treeitem", { selected: true });
  await tabTo(page, tree);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  const row = task(page, "Untagged insert");
  await expect(row).toHaveAttribute("aria-selected", "true");
  const cursor = await row.getAttribute("id");
  expect(cursor).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(selected).toHaveCount(0);
  const before = await tree.ariaSnapshot();
  for (const key of ["x", "i", "o", "g", "m", "F2", "Enter"]) {
    await page.keyboard.press(key);
    await expect(tree).toBeFocused();
    await expect(tree).toHaveAttribute("aria-activedescendant", cursor!);
    await expect(selected).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tree.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    expect(await tree.ariaSnapshot()).toBe(before);
  }
  await page.keyboard.press("Space");
  await expect(selected).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-selected", "true");
});

test("AT-16, AT-24 and AT-28 · retain outline state across pane and perspective changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 640 });
  await page.goto("/");
  const divider = page.getByRole("separator", { name: "Resize inspector" });
  const beforeResize = await inspector(page).boundingBox();
  if (!beforeResize) throw new Error("Desktop inspector is missing");
  await tabTo(page, divider);
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await inspector(page).boundingBox())?.width ?? 0)
    .toBeGreaterThan(beforeResize.width);
  const tree = page.getByRole("tree", { name: "Task outline" });
  await tabTo(page, tree);
  await page.keyboard.press("End");
  const selected = tree.getByRole("treeitem", { selected: true });
  await expect(selected).toHaveCount(1);
  const id = await selected.getAttribute("data-task-id");
  await expect.poll(async () => (await visibleAnchor(tree)).top).toBeGreaterThan(0);
  const before = await visibleAnchor(tree);
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await capture.fill("Unsubmitted Inbox draft");
  await sidebarDestination(page, "Punch list").click();
  await expect(capture).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Punch list", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Perspectives" })
    .getByRole("button", { name: "Inbox", exact: true })
    .click();
  await expect(capture).toHaveValue("Unsubmitted Inbox draft");
  await expect(selected).toHaveAttribute("data-task-id", id!);
  await expect.poll(async () => (await visibleAnchor(tree)).id).toBe(before.id);
  expect(Math.abs((await visibleAnchor(tree)).top - before.top)).toBeLessThanOrEqual(2);

  await page.reload();
  await expect(capture).toHaveValue("");
  await expect(tree.getByRole("treeitem", { name: "Unsubmitted Inbox draft" })).toHaveCount(0);
});
