import { expect, test, type Locator, type Page } from "@playwright/test";
import { inspector, sidebarDestination, task } from "./controls.ts";

const wrap = "Wrapped title " + "at a narrow width ".repeat(14).trim();
const titles = Array.from({ length: 260 }, (_, i) =>
  i === 258 ? wrap : "Field entry " + (i + 1),
);

async function populate(page: Page) {
  await page.goto("/");
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await capture.fill(titles.join("\n"));
  await capture.press("Enter");
  await expect(capture).toHaveValue("");
  const tree = page.getByRole("tree", { name: "Task outline" });
  await expect(tree.getByRole("treeitem").first()).toHaveAttribute(
    "aria-setsize",
    "284",
  );
  return tree;
}

function anchor(tree: Locator) {
  return tree.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll("[data-task-id]")].find(
      (node) => node.getBoundingClientRect().bottom > top,
    );
    return {
      id: row?.getAttribute("data-task-id"),
      offset: row ? Math.round(row.getBoundingClientRect().top - top) : null,
    };
  });
}

async function expectActive(tree: Locator, row: Locator) {
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    (await row.getAttribute("id"))!,
  );
  await expect(row).toBeInViewport();
}

test("AT-24 · navigate, extend and restore the large outline by stable row ID", async ({
  page,
}) => {
  const tree = await populate(page);
  await expect(tree.getByRole("treeitem")).not.toHaveCount(284);
  await tree.focus();
  await tree.press("Home");
  await expectActive(tree, task(page, "Loose receipt"));
  // Walk across the initial mount boundary without moving DOM focus off the tree.
  for (let step = 0; step < 36; step++) await tree.press("ArrowDown");
  await expectActive(tree, task(page, "Field entry 13"));
  await tree.press("End");
  const last = task(page, "Field entry 260");
  await expectActive(tree, last);
  await expect(last).toHaveAttribute("aria-posinset", "284");
  await tree.press("Shift+Home");
  await expectActive(tree, task(page, "Loose receipt"));
  await expect(page.getByText("284 selected", { exact: true })).toBeVisible();
  await tree.press("End");
  await tree.press("ArrowUp");
  await expectActive(tree, task(page, wrap));
  await tree.press("F2");
  const input = page.getByRole("textbox", { name: "Task title", exact: true });
  await expect(input).toBeFocused();
  // Scroll the editor and its active row out of view without losing either.
  await tree.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(task(page, "Loose receipt")).toBeInViewport();
  await expect(input).toBeFocused();
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    (await task(page, wrap).getAttribute("id"))!,
  );
  await input.press("Escape");
  await expect(tree).toBeFocused();
  await expectActive(tree, task(page, wrap));

  await tree.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  await expect(task(page, wrap)).not.toBeInViewport();
  const before = await anchor(tree);
  expect(before.id).toBeTruthy();
  await sidebarDestination(page, "Punch list").click();
  await page
    .getByRole("navigation", { name: "Perspectives" })
    .getByRole("button", { name: "Inbox", exact: true })
    .click();
  await expect.poll(() => anchor(tree)).toEqual(before);
  await expect(task(page, wrap)).toHaveAttribute("aria-selected", "true");
  await tree.focus();
  await expectActive(tree, task(page, wrap));
});

test.describe("Touch outline", () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 820 } });
  test("AT-28 · touch a wrapped virtual row and reopen the inspector by ID", async ({
    page,
  }) => {
    const tree = await populate(page);
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const row = task(page, wrap);
    const last = task(page, "Field entry 260");
    await expect(row).toBeInViewport();
    await expect
      .poll(() =>
        row.evaluate((node) => {
          const next = node.nextElementSibling;
          if (!next) return false;
          const box = node.getBoundingClientRect();
          return (
            box.height > 60 &&
            Math.abs(box.bottom - next.getBoundingClientRect().top) < 1
          );
        }),
      )
      .toBe(true);
    await row.getByText(wrap, { exact: true }).tap();
    await expectActive(tree, row);
    const id = await row.getAttribute("data-task-id");
    await page.getByRole("button", { name: "Inspector", exact: true }).tap();
    await expect(
      inspector(page).getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue(wrap);
    await inspector(page)
      .getByRole("button", { name: "Close inspector" })
      .tap();
    await expect(row).toHaveAttribute("data-task-id", id!);
    await expectActive(tree, row);
    await last.getByText("Field entry 260", { exact: true }).tap();
    await expectActive(tree, last);
  });
});

test("AT-24 · drag a selected subtree across virtual viewports without losing the source", async ({
  page,
}) => {
  const tree = await populate(page);
  await tree.focus();
  await tree.press("Home");
  await tree.press("Shift+ArrowDown");
  const first = task(page, "Loose receipt");
  const second = task(page, "Untagged insert");
  await expectActive(tree, second);
  const surface = await first
    .getByText("Loose receipt", { exact: true })
    .boundingBox();
  if (!surface) throw new Error("The selected source row is missing");
  const x = surface.x + surface.width / 2;
  const y = surface.y + surface.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 18, y, { steps: 5 });
    await expect(page.getByLabel("Move dragged tasks")).toBeVisible();
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const destination = task(page, "Field entry 260");
    await expect(destination).toBeInViewport();
    await expect(first).toBeAttached();
    const box = await destination.boundingBox();
    if (!box) throw new Error("The destination row is missing");
    const center = box.x + box.width / 2,
      middle = box.y + box.height / 2;
    await page.mouse.move(center, middle, { steps: 8 });
    await page.mouse.move(center + 1, middle);
    await expect(destination).toHaveAttribute("data-drop-before", "true");
  } finally {
    await page.mouse.up();
  }
  await expect(first).toHaveAttribute("aria-posinset", "282");
  await expect(second).toHaveAttribute("aria-posinset", "283");
  await expect(second).toHaveAttribute("aria-selected", "true");
});
