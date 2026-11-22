import { expect, test, type Locator } from "@playwright/test";
import { inspector, sidebarDestination, tabTo } from "./controls.ts";

function visibleAnchor(tree: Locator) {
  return tree.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = Array.from(element.querySelectorAll("[data-task-id]")).find(
      (node) => node.getBoundingClientRect().bottom > top,
    );
    return { id: row?.getAttribute("data-task-id"), top: element.scrollTop };
  });
}

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
