import { expect, test } from "@playwright/test";
import { inspector, task, taskId } from "../../e2e/controls.ts";
import { signIn } from "../account.ts";

// Firefox supports touch contexts with a narrow viewport. Mobile meta-viewport
// emulation is separate and is exercised by the existing Chromium device suite.
test.use({ viewport: { width: 320, height: 780 }, hasTouch: true });

test("AT-24/28 · use touch and return focus from the 320px inspector and navigation", async ({
  page,
}) => {
  await signIn(page, "neighbor");
  const add = page.getByRole("button", { name: "Add task", exact: true });
  await add.tap();
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await expect(capture).toBeFocused();
  await capture.fill("Sketch footing");
  await page.getByRole("button", { name: "Add tasks", exact: true }).tap();
  const id = await taskId(page, "Sketch footing");
  const [pointerType] = await Promise.all([
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            "pointerdown",
            (event) => resolve(event.pointerType),
            { once: true },
          );
        }),
    ),
    task(page, "Sketch footing").tap(),
  ]);
  expect(pointerType).toBe("touch");
  const inspect = page.getByRole("button", { name: "Inspector", exact: true });
  await inspect.tap();
  const panel = inspector(page);
  await expect(panel).toBeFocused();
  await expect(page.getByRole("tree", { name: "Task outline" })).toBeHidden();
  const title = panel.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Footing sketched");
  await panel.getByRole("button", { name: "Apply title", exact: true }).tap();
  await expect(page.getByRole("contentinfo").getByRole("status")).toContainText(
    "Saved",
  );
  await panel.getByRole("button", { name: "Close inspector" }).tap();
  await expect(inspect).toBeFocused();
  await expect(inspect).toHaveAttribute("aria-expanded", "false");
  await expect(task(page, "Footing sketched")).toHaveAttribute(
    "data-task-id",
    id,
  );
  const browse = page.getByRole("button", { name: "Browse", exact: true });
  await browse.tap();
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  await expect(
    navigation.getByRole("button", { name: "Inbox", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(browse).toBeFocused();
  await expect(navigation).toBeHidden();
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    coarse: matchMedia("(pointer: coarse)").matches,
  }));
  expect(viewport.width).toBe(320);
  expect(viewport.content).toBeLessThanOrEqual(viewport.width);
  const bounds = await add.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(viewport.coarse ? 44 : 24);
  expect(bounds!.width).toBeGreaterThanOrEqual(24);
});
