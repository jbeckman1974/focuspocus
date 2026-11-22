import { expect, type Page } from "@playwright/test";
import { inspector, task } from "../e2e/controls.ts";

export async function openPlanning(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Perspectives", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

export async function applyDay(
  page: Page,
  title: string,
  field: "planned" | "due",
  value: string,
) {
  await task(page, title).getByText(title, { exact: true }).click();
  await inspector(page)
    .getByRole("button", { name: "Schedule…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit schedule" });
  await dialog.getByLabel("Date field").selectOption(field);
  await dialog.getByLabel("Date input").fill(value);
  await dialog
    .getByRole("button", { name: "Preview date", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(value);
  const acknowledgement = page.waitForResponse(/\/commands\/set-schedule$/);
  await dialog.getByRole("button", { name: "Apply date", exact: true }).click();
  expect((await acknowledgement).status()).toBe(200);
}

export function forecastItem(
  page: Page,
  date: string,
  section: string,
  title: string,
) {
  return page
    .getByRole("region", { name: date, exact: true })
    .getByRole("region", { name: section, exact: true })
    .getByRole("button", { name: title, exact: true });
}

export async function focusProject(page: Page, name: string) {
  await page.getByRole("button", { name: "Focus…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Focus", exact: true });
  await dialog.getByRole("checkbox", { name, exact: true }).check();
  await dialog
    .getByRole("button", { name: "Apply focus", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
