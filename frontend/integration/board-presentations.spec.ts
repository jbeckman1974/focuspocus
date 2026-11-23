import { expect, test, type Page } from "@playwright/test";
import { inspector, task } from "../e2e/controls.ts";
import { signIn, submitCapture, withProfile } from "./account.ts";

function boardCard(page: Page, lane: string, title: string) {
  return page
    .getByRole("region", { name: "Task board" })
    .getByRole("region", { name: lane, exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: title, exact: true }) });
}

test("AT-01/16/17 · the same private task moves through the board, list and due-date calendar", async ({
  page,
  browser,
}) => {
  const title = "Confirm the offsite venue";
  await signIn(page, "owner");
  await page.goto("/app/#board");
  const layouts = page.getByRole("group", { name: "Task view" });
  await expect(layouts.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: "Add task to Inbox", exact: true })
    .click();
  await submitCapture(page, title);

  const next = boardCard(page, "Next", title);
  const progress = boardCard(page, "In progress", title);
  const done = boardCard(page, "Done", title);
  await expect(next).toHaveAttribute("data-task-id", /.+/);
  const id = (await next.getAttribute("data-task-id"))!;
  await next.getByRole("button", { name: title, exact: true }).click();
  await next.getByRole("button", { name: "Start task", exact: true }).click();
  await expect(progress).toHaveAttribute("data-task-id", id);
  await expect(next).toHaveCount(0);

  await withProfile(browser, "owner", async (reader) => {
    await reader.goto("/app/#board");
    await expect(boardCard(reader, "In progress", title)).toHaveAttribute(
      "data-task-id",
      id,
    );
  });

  await progress
    .getByRole("button", { name: "Complete " + title, exact: true })
    .click();
  await expect(done).toHaveAttribute("data-task-id", id);
  await expect(progress).toHaveCount(0);
  await done
    .getByRole("button", { name: "Reopen " + title, exact: true })
    .click();
  await expect(progress).toHaveAttribute("data-task-id", id);
  await page.reload();
  await expect(progress).toHaveAttribute("data-task-id", id);
  await expect(done).toHaveCount(0);
  await progress.getByRole("button", { name: title, exact: true }).click();
  await progress
    .getByRole("button", { name: "Return to Next", exact: true })
    .click();
  await expect(next).toHaveAttribute("data-task-id", id);

  await layouts.getByRole("button", { name: "List" }).click();
  await expect(layouts.getByRole("button", { name: "List" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const row = task(page, title);
  await expect(row).toHaveAttribute("data-task-id", id);
  await row.getByText(title, { exact: true }).click();
  const details = inspector(page);
  await details.getByLabel("Due date", { exact: true }).fill("2028-02-29");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/commands\/bulk-edit\/?$/.test(new URL(response.url()).pathname),
  );
  await details
    .getByRole("button", { name: "Apply date", exact: true })
    .click();
  expect((await saved).ok()).toBeTruthy();
  await layouts.getByRole("button", { name: "Calendar" }).click();
  await expect(
    layouts.getByRole("button", { name: "Calendar" }),
  ).toHaveAttribute("aria-pressed", "true");
  const calendar = page.getByRole("region", { name: "Task calendar" });
  await expect(
    calendar.getByRole("grid", { name: "Due dates for February 2028" }),
  ).toBeVisible();
  const agenda = calendar.getByRole("region", { name: "Selected day agenda" });
  await expect(
    agenda.getByRole("button", { name: title, exact: true }),
  ).toHaveAttribute("data-task-id", id);
});
