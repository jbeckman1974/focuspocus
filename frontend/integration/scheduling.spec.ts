import { expect, test } from "@playwright/test";
import { inspector, sidebarDestination, task, taskId } from "../e2e/controls.ts";
import { createDestination, signIn, submitCapture } from "./account.ts";

test("AT-07/09 · preview a due date and complete a repeating action", async ({
  page,
}) => {
  await signIn(page, "owner");
  const project = "Instrument service schedule";
  const title = "A22 Daily check";
  await createDestination(page, "project", project);
  await sidebarDestination(page, project).click();
  await submitCapture(page, title);
  const originalId = await taskId(page, title);
  await task(page, title).getByText(title, { exact: true }).click();
  const inspect = inspector(page);
  await inspect.getByRole("button", { name: "Schedule…", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit schedule" });
  await edit.getByLabel("Date field").selectOption("due");
  await edit.getByLabel("Date input").fill("2026-11-18");
  const apply = edit.getByRole("button", { name: "Apply date" });
  await expect(apply).toBeDisabled();
  await edit.getByRole("button", { name: "Preview date" }).click();
  await expect(edit.getByRole("status")).toContainText("2026-11-18");
  await apply.click();
  await inspect.getByRole("button", { name: "Repeat…", exact: true }).click();
  const repeat = page.getByRole("dialog", { name: "Edit repetition" });
  await repeat.getByLabel("Schedule from").selectOption("regular");
  await repeat.getByLabel("Repeat unit").selectOption("day");
  await repeat.getByLabel("Repeat interval").fill("1");
  await repeat.getByLabel("Skip missed occurrences").uncheck();
  await repeat.getByLabel("Repeat ending").selectOption("count");
  await repeat.getByLabel("Occurrence count").fill("4");
  await repeat.getByRole("button", { name: "Save repeat" }).click();
  await task(page, title)
    .getByRole("button", { name: `Complete ${title}`, exact: true })
    .click();
  const sameTitle = task(page, title);
  await expect(sameTitle).toHaveCount(2);
  const identities = await sameTitle.evaluateAll((elements) =>
    elements.map((row) => row.getAttribute("data-task-id")),
  );
  expect(identities).toContain(originalId);
  const successorId = identities.find((id) => id !== originalId);
  expect(successorId).toBeTruthy();
  await page.reload();
  await sidebarDestination(page, project).click();
  const original = sameTitle.and(page.locator(`[data-task-id="${originalId}"]`));
  const successor = sameTitle.and(page.locator(`[data-task-id="${successorId}"]`));
  await expect(
    original.getByRole("button", { name: `Reopen ${title}`, exact: true }),
  ).toBeVisible();
  await successor.getByText(title, { exact: true }).click();
  await inspect.getByRole("button", { name: "Schedule…", exact: true }).click();
  await expect(edit.getByText(/^Direct due:/)).toContainText("2026-11-19");
  await edit.getByRole("button", { name: "Close", exact: true }).click();
  await inspect.getByRole("button", { name: "Repeat…", exact: true }).click();
  await expect(repeat.getByText(/^Occurrence:/)).toContainText("Remaining: 3");
});
