import { expect, test, type Route } from "@playwright/test";
import { signIn } from "./account.ts";
import { createShared, selectWorkspace } from "./workspace-tools.ts";

test("a failed switch between identically named workspaces restores the current draft until retry", async ({
  page,
}) => {
  await signIn(page, "planner");
  const first = await createShared(page, "Delivery notes");
  const second = await createShared(page, "Delivery notes");
  expect(first).not.toBe(second);
  const picker = page.getByLabel("Active workspace");
  const firstLabel = await picker
    .locator(`option[value="${first}"]`)
    .innerText();
  const secondLabel = await picker
    .locator(`option[value="${second}"]`)
    .innerText();
  expect(firstLabel).toContain(first.slice(0, 8));
  expect(secondLabel).toContain(second.slice(0, 8));
  expect(firstLabel).not.toBe(secondLabel);
  const capture = page.getByRole("textbox", { name: "Task titles" });
  const draft = "Draft in the second workspace";
  await capture.fill(draft);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const directory = /\/api\/v1\/sharing\/workspaces$/;
  const failDirectory = async (route: Route) => {
    if (route.request().method() !== "GET") return route.continue();
    entered();
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: "Directory temporarily unavailable" },
    });
  };
  await page.route(directory, failDirectory);
  try {
    await picker.selectOption(first);
    await intercepted;
    await expect(
      page.getByText("Switching workspace…", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Workspace tools…" }),
    ).toHaveCount(0);
    await expect(capture).toHaveCount(0);
  } finally {
    release();
  }
  const retry = page.getByRole("button", { name: "Retry workspace switch" });
  await expect(retry).toBeVisible();
  await page.unroute(directory, failDirectory);
  await expect(picker).toHaveValue(second);
  await expect(capture).toHaveValue(draft);
  await selectWorkspace(page, first, () => retry.click());
  await expect(capture).toHaveValue("");
});
