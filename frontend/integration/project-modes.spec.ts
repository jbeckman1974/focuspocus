import { expect, test, type Page } from "@playwright/test";
import { sidebarDestination, task, taskId } from "../e2e/controls.ts";
import { createDestination, signIn, submitCapture } from "./account.ts";

const titles = ["A11 Battery", "A12 Photos", "A13 Café ledger"];

async function expectTaskOrder(page: Page, filter: string, expected: string[]) {
  await page.getByLabel("Availability", { exact: true }).selectOption(filter);
  const rows = page
    .getByRole("tree", { name: "Task outline" })
    .getByRole("treeitem");
  await expect
    .poll(() =>
      rows.evaluateAll((elements) =>
        elements.map((row) => row.getAttribute("data-task-id")),
      ),
    )
    .toEqual(expected);
}

for (const mode of ["sequential", "parallel", "single-action"]) {
  test(`AT-02 · ${mode} project preserves manual order across availability filters`, async ({
    page,
  }) => {
    await signIn(page, "owner");
    const project = `P03 Punch list · ${mode}`;
    await createDestination(page, "project", project);
    await sidebarDestination(page, project).click();
    await submitCapture(page, titles.join("\n"));
    const ids = await Promise.all(titles.map((title) => taskId(page, title)));
    expect(new Set(ids).size).toBe(3);
    const modeControl = page.getByLabel("Project mode", { exact: true });
    await modeControl.selectOption(mode);
    await expect(modeControl).toHaveValue(mode);
    const first = ids.slice(0, 1);
    await expectTaskOrder(
      page,
      "available",
      mode === "sequential" ? first : ids,
    );
    await expectTaskOrder(
      page,
      "first-available",
      mode === "single-action" ? ids : first,
    );
    await task(page, titles[0])
      .getByRole("button", { name: `Complete ${titles[0]}`, exact: true })
      .click();
    await expectTaskOrder(page, "remaining", ids.slice(1));
    await expectTaskOrder(page, "everything", ids);
    await expect(
      task(page, titles[0]).getByRole("button", {
        name: `Reopen ${titles[0]}`,
      }),
    ).toBeVisible();
  });
}
