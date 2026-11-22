import { readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { sidebarDestination, task } from "../e2e/controls.ts";

type Person = "owner" | "neighbor" | "planner";
type Credentials = { username: string; password: string };

export async function signIn(page: Page, person: Person) {
  const accounts: Record<Person, Credentials> = JSON.parse(
    readFileSync("/run/qa-accounts.json", "utf8"),
  );
  await page.goto("/app/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(accounts[person].username);
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toBeVisible();
  await password.fill(accounts[person].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("tree", { name: "Task outline" })).toBeVisible();
}

export async function withProfile(
  browser: Browser,
  person: Person,
  journey: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8000",
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    await signIn(page, person);
    await journey(page);
  } finally {
    await context.close();
  }
}

export async function createDestination(
  page: Page,
  kind: "project" | "tag",
  title: string,
) {
  await page.getByRole("button", { name: `New ${kind}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `New ${kind}` });
  await dialog.getByRole("textbox").fill(title);
  await dialog.getByRole("button", { name: `Create ${kind}` }).click();
  await expect(sidebarDestination(page, title)).toBeVisible();
}

export async function submitCapture(page: Page, titles: string) {
  await page.getByRole("textbox", { name: "Task titles" }).fill(titles);
  await page.getByRole("button", { name: "Add tasks", exact: true }).click();
}

export async function submitRename(page: Page, from: string, to: string) {
  await task(page, from).getByText(from, { exact: true }).dblclick();
  await page.getByRole("textbox", { name: "Task title", exact: true }).fill(to);
  await page.getByRole("button", { name: "Save title", exact: true }).click();
}
