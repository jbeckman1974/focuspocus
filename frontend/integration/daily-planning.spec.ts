import { expect, test } from "@playwright/test";
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
import {
  applyDay,
  focusProject,
  forecastItem,
  openPlanning,
} from "./planning-controls.ts";

test("AT-14/15/16/25/32 · capture, forecast, focus, annotate and review a private project", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const project = "Field verification rounds";
  const title = "Bench route";
  const other = "Capacity check";
  const savedName = "Field work this week";
  const note = "Survey monument checked today.";
  const attachmentName = "m4-field-check.txt";
  const attachment = Buffer.from(
    "Field book fixture\nPoint 17 · Café\n",
    "utf8",
  );
  const planned = "2027-03-03";
  const due = "2027-03-06";

  await signIn(page, "planner");
  await createDestination(page, "project", project);
  await sidebarDestination(page, project).click();
  await submitCapture(page, [title, other].join("\n"));
  const original = await taskId(page, title);
  await applyDay(page, title, "planned", planned);
  await applyDay(page, title, "due", due);

  await openPlanning(page, "Forecast");
  await page.getByLabel("Start date", { exact: true }).fill(planned);
  await expect(forecastItem(page, planned, "Planned", title)).toHaveAttribute(
    "data-item-id",
    original,
  );
  await expect(forecastItem(page, due, "Due", title)).toHaveAttribute(
    "data-item-id",
    original,
  );

  await forecastItem(page, planned, "Planned", title).click();
  await openPlanning(page, "Perspectives");
  const selectionOnly = page.getByLabel("Selected rows only", { exact: true });
  await selectionOnly.check();
  const matches = page.getByRole("region", { name: "Search results" });
  await expect(matches.getByRole("status")).toHaveText("1 match");
  await expect(
    matches.getByRole("button", { name: title, exact: true }),
  ).toHaveAttribute("data-item-id", original);
  await selectionOnly.uncheck();
  await focusProject(page, project);
  await page
    .getByRole("button", { name: "New perspective", exact: true })
    .click();
  await page.getByLabel("Perspective name", { exact: true }).fill(savedName);
  await page.getByLabel("Favorite", { exact: true }).check();
  const attempts: string[] = [];
  await page.route(/\/perspectives\/commands$/, async (route) => {
    const write = route.request().postDataJSON();
    if (write.action !== "save") return route.continue();
    attempts.push(write.operationId);
    if (attempts.length > 1) return route.continue();
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("connectionreset");
  });
  await page
    .getByRole("button", { name: "Save perspective", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit perspective" });
  await editor.getByRole("button", { name: "Retry same change" }).click();
  await expect(editor).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  await page
    .getByRole("group", { name: "Saved perspectives" })
    .getByRole("button", { name: savedName, exact: true })
    .click();
  await page.getByLabel("Search tasks", { exact: true }).fill("Bench");
  const result = page.getByRole("button", { name: title, exact: true });
  await expect(result).toHaveAttribute("data-item-id", original);
  await expect(
    page.getByRole("button", { name: other, exact: true }),
  ).toHaveCount(0);
  await result.click();

  await page
    .getByRole("button", { name: "Notes and files…", exact: true })
    .click();
  const content = page.getByRole("dialog", { name: "Notes and files" });
  const noteText = content.getByRole("textbox", { name: "Note text" });
  await noteText.fill(note);
  await noteText.press("ControlOrMeta+a");
  await content.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(content.locator("strong")).toHaveText(note);
  await content.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(content.getByRole("status")).toHaveText("Saved.");
  await content.getByLabel("Attach file", { exact: true }).setInputFiles({
    name: attachmentName,
    mimeType: "text/plain",
    buffer: attachment,
  });
  await content
    .getByRole("button", { name: "Upload file", exact: true })
    .click();
  const download = content.getByRole("link", {
    name: "Download " + attachmentName,
    exact: true,
  });
  await expect(download).toBeVisible();
  const href = await download.getAttribute("href");
  if (!href) throw new Error("The uploaded file has no download URL");
  await content.getByRole("button", { name: "Close", exact: true }).click();
  const searched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/perspectives/query") &&
      response.request().postDataJSON()?.text === "monument",
  );
  await page.getByLabel("Search tasks", { exact: true }).fill("monument");
  expect((await searched).status()).toBe(200);
  await expect(result).toHaveAttribute("data-item-id", original);

  await withProfile(browser, "neighbor", async (outsider) => {
    const response = await outsider.request.get(href);
    expect(response.status()).toBe(404);
  });

  await sidebarDestination(page, project).click();
  await task(page, title).getByText(title, { exact: true }).click();
  await task(page, other)
    .getByText(other, { exact: true })
    .click({ modifiers: ["Shift"] });
  await inspector(page)
    .getByRole("button", { name: "Bulk edit…", exact: true })
    .click();
  const bulk = page.getByRole("dialog", { name: "Edit selected items" });
  await bulk.getByLabel("Change flag", { exact: true }).check();
  await bulk
    .getByRole("combobox", { name: "Flag", exact: true })
    .selectOption({ label: "Flagged" });
  const edited = page.waitForResponse(/\/commands\/bulk-inspect$/);
  await bulk
    .getByRole("button", { name: "Apply to selection", exact: true })
    .click();
  expect((await edited).status()).toBe(200);

  await openPlanning(page, "Review");
  await page.getByLabel("Review scope", { exact: true }).selectOption("all");
  await page
    .getByRole("group", { name: "Review queue" })
    .getByRole("button", { name: project, exact: true })
    .click();
  const marked = page.waitForResponse(/\/commands\/mark-reviewed$/);
  await page
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  expect((await marked).status()).toBe(200);
  await withProfile(browser, "planner", async (second) => {
    const response = await second.request.get(href);
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(attachment);
    await sidebarDestination(second, project).click();
    for (const selectedTitle of [title, other]) {
      await expect(task(second, selectedTitle)).toHaveAccessibleDescription(
        /Flagged\./,
      );
    }
    await task(second, title).getByText(title, { exact: true }).click();
    await inspector(second)
      .getByRole("button", { name: "Notes and files…", exact: true })
      .click();
    const reopened = second.getByRole("dialog", { name: "Notes and files" });
    await expect(reopened.locator("strong")).toHaveText(note);
  });
  await sidebarDestination(page, project).click();
  const row = task(page, title);
  const complete = row.getByRole("button", {
    name: "Complete " + title,
    exact: true,
  });
  await complete.click();
  await expect(
    row.getByRole("button", { name: "Reopen " + title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(complete).toBeVisible();
  await page.reload();
  await sidebarDestination(page, project).click();
  await expect(row).toHaveAttribute("data-task-id", original);
  await expect(complete).toBeVisible();
});
