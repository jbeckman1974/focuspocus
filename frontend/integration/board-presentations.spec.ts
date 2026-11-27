import { expect, test, type Page } from "@playwright/test";
import {
  inspector,
  sidebarDestination,
  task,
  taskId,
} from "../e2e/controls.ts";
import {
  createDestination,
  signIn,
  submitCapture,
  withProfile,
} from "./account.ts";
import { openPlanning } from "./planning-controls.ts";

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

test("Projects keeps three identically titled tasks distinguishable in List, Next, Calendar and search", async ({
  page,
}) => {
  await signIn(page, "owner");
  const title = "Check the field drawing";
  const projects = ["Alder survey", "Juniper survey", "Willow survey"];
  const ids = new Map<string, string>();
  for (const project of projects) {
    await createDestination(page, "project", project);
    await sidebarDestination(page, project).click();
    await submitCapture(page, title);
    const id = await taskId(page, title);
    ids.set(project, id);
  }
  expect(new Set(ids.values()).size).toBe(projects.length);
  await openPlanning(page, "Projects");
  await page
    .getByLabel("Availability", { exact: true })
    .selectOption("first-available");
  for (const [project, id] of ids) {
    const row = page
      .getByRole("treeitem", { name: title, exact: true })
      .filter({
        has: page.getByText(project, { exact: true }),
      });
    await expect(row).toHaveAttribute("data-task-id", id);
    await expect(row).toHaveAccessibleDescription(new RegExp(project));
  }

  const layouts = page.getByRole("group", { name: "Task view" });
  await layouts.getByRole("button", { name: "Board" }).click();
  const next = page.getByRole("region", { name: "Next", exact: true });
  for (const [project, id] of ids) {
    const card = next.locator(`[data-task-id="${id}"]`);
    await expect(card.getByText(project, { exact: true })).toBeVisible();
    await expect(
      card.getByRole("button", { name: title, exact: true }),
    ).toHaveAccessibleDescription(`Project: ${project}`);
  }
  await layouts.getByRole("button", { name: "Calendar" }).click();
  for (const [project, id] of ids) {
    const agendaTask = page.locator(`.calendar-agenda [data-task-id="${id}"]`);
    await expect(agendaTask.getByText(project, { exact: true })).toBeVisible();
    await expect(agendaTask).toHaveAccessibleDescription(`Project: ${project}`);
  }
  await page.getByRole("button", { name: "Search…", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill(title);
  const results = page.getByRole("region", { name: "Search results" });
  for (const [project, id] of ids) {
    const result = results.locator(`[data-item-id="${id}"]`);
    await expect(result.getByText(project, { exact: true })).toBeVisible();
    await expect(result).toHaveAccessibleDescription(`Project: ${project}`);
  }
});
