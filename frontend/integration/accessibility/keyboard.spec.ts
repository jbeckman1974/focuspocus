import { expect, test } from "@playwright/test";
import {
  activate,
  chooseWithKeys,
  selectTaskWithKeys,
  sidebarDestination,
  tabTo,
  task,
  taskId,
} from "../../e2e/controls.ts";
import { signIn, withProfile } from "../account.ts";

test.beforeAll(async ({ browser, browserName }) => {
  console.log(
    `Accessibility qualification: ${browserName} ${browser.version()}`,
  );
});

test("AT-16/17/24 · organize a private outline by keyboard and keep its named selection", async ({
  page,
  browser,
}) => {
  await signIn(page, "planner");
  const tree = page.getByRole("tree", { name: "Task outline" });
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await activate(
    page,
    page.getByRole("button", { name: "Add task", exact: true }),
  );
  await expect(capture).toBeFocused();
  const titles = ["Field equipment", "Prism target", "Tripod"];
  await page.keyboard.insertText(titles.join("\n"));
  await page.keyboard.press("Enter");
  const tripodId = await taskId(page, "Tripod");
  await selectTaskWithKeys(page, "Prism target");
  await page.keyboard.press("Shift+ArrowDown");
  const tripod = task(page, "Tripod");
  await expect(tripod).toHaveAttribute("aria-selected", "true");
  await expect(task(page, "Prism target")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    (await tripod.getAttribute("id"))!,
  );
  await expect(tripod).toHaveAccessibleDescription(/Active/);
  await expect(tripod).toHaveCSS("outline-style", "solid");
  await expect(tripod).toBeInViewport();
  expect(
    await tripod.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const center = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return element.contains(center);
    }),
    "The visible focus row is unobscured",
  ).toBe(true);
  await page.keyboard.press("i");
  await expect(tripod).toHaveAttribute("aria-level", "2");
  await expect(tripod).toHaveAttribute("aria-posinset", "2");
  await expect(tripod).toHaveAttribute("aria-setsize", "2");

  await selectTaskWithKeys(page, titles[0]);
  const parent = task(page, titles[0]);
  await page.keyboard.press("ArrowLeft");
  await expect(parent).toHaveAttribute("aria-expanded", "false");
  await expect(tripod).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(tripod).toHaveAttribute("data-task-id", tripodId);
  await selectTaskWithKeys(page, "Tripod");
  await page.keyboard.press("Shift+F10");
  const dialog = page.getByRole("dialog", { name: "Outline commands" });
  await expect(
    dialog.getByRole("searchbox", { name: "Find a command" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(tree).toBeFocused();
  await page.keyboard.press("F2");
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Tripod checked");
  await page.keyboard.press("Enter");
  const revised = task(page, "Tripod checked");
  await expect(revised).toHaveAttribute("data-task-id", tripodId);
  await expect(tree).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("u");
  await expect(tripod).toHaveAttribute("data-task-id", tripodId);
  await expect(page.getByRole("contentinfo").getByRole("status")).toContainText(
    "Saved",
  );

  await withProfile(browser, "neighbor", async (other) => {
    const all = other
      .getByRole("navigation", { name: "Perspectives", exact: true })
      .getByRole("button", { name: "All tasks" });
    await activate(other, all);
    await expect(
      other.getByRole("heading", { name: "Everything", exact: true }),
    ).toBeVisible();
    await expect(task(other, "Tripod")).toHaveCount(0);
  });
});

test("AT-15/24 · review a project by keyboard without completing its action", async ({
  page,
}) => {
  await signIn(page, "planner");
  const project = "Accessible project review";
  await activate(
    page,
    page.getByRole("button", { name: "New project", exact: true }),
  );
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(
    dialog.getByRole("textbox", { name: "Project name" }),
  ).toBeFocused();
  await page.keyboard.insertText(project);
  await page.keyboard.press("Enter");
  await expect(sidebarDestination(page, project)).toBeVisible();
  await activate(page, sidebarDestination(page, project));
  const label = "Pending inspection";
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await expect(capture).toHaveAttribute(
    "placeholder",
    `Add a task to ${project}…`,
  );
  await tabTo(page, capture);
  await page.keyboard.insertText(label);
  await page.keyboard.press("Enter");
  const id = await taskId(page, label);
  const nav = page.getByRole("navigation", {
    name: "Perspectives",
    exact: true,
  });
  await activate(
    page,
    nav.getByRole("button", { name: "Review", exact: true }),
  );
  const review = page.getByRole("region", { name: "Review", exact: true });
  await chooseWithKeys(
    page,
    review.getByRole("combobox", { name: "Review scope" }),
    "All projects",
  );
  const item = review.getByRole("button", { name: label, exact: true });
  await expect(item).toHaveAttribute("data-item-id", id);
  await activate(page, item);
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await activate(page, review.getByRole("button", { name: "Mark reviewed" }));
  await expect(review.getByText(/Last reviewed/)).toBeVisible();
  await activate(page, sidebarDestination(page, project));
  await expect(task(page, label)).toHaveAttribute("data-task-id", id);
  await expect(task(page, label)).toHaveAccessibleDescription(/Active/);
});
