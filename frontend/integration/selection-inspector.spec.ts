import { expect, test } from "@playwright/test";
import { inspector, task } from "../e2e/controls.ts";
import { signIn, submitCapture, submitRename } from "./account.ts";

test("the inspector replaces its controls and shows only the selected tasks", async ({
  page,
}) => {
  await signIn(page, "owner");
  const first = "Check the north boundary";
  const second = "Check the south boundary";
  const third = "Mark the access road";
  await submitCapture(page, [first, second, third].join("\n"));

  const panel = inspector(page);
  const properties = panel.getByRole("group", { name: "Action properties" });
  const notes = panel.getByRole("button", { name: "Notes and files…" });
  const titleField = panel.getByRole("textbox", { name: "Title", exact: true });
  for (const title of [first, second, first, third]) {
    await task(page, title).getByText(title, { exact: true }).click();
    await expect(titleField).toHaveValue(title);
    await expect(properties).toHaveCount(1);
    await expect(notes).toHaveCount(1);
  }

  await task(page, first).click({ modifiers: ["ControlOrMeta"] });
  await panel.getByText("2 items selected", { exact: true }).click();
  const selection = panel.getByRole("list", { name: "Selected tasks" });
  await expect(selection.getByRole("listitem")).toHaveCount(2);
  await expect(selection.getByText(first, { exact: true })).toBeVisible();
  await expect(selection.getByText(third, { exact: true })).toBeVisible();
  await expect(properties).toHaveCount(0);
  await expect(notes).toHaveCount(0);

  await task(page, second).click();
  await expect(selection).toHaveCount(0);
  await expect(titleField).toHaveValue(second);
  await expect(properties).toHaveCount(1);
  await expect(notes).toHaveCount(1);
  await titleField.fill("Verify the south boundary");
  await panel.getByRole("button", { name: "Apply title" }).click();
  await expect(task(page, "Verify the south boundary")).toBeVisible();
  await expect(task(page, first)).toBeVisible();
  await expect(task(page, third)).toBeVisible();

  await page.getByRole("tree", { name: "Task outline" }).press("Escape");
  await expect(
    panel.getByText("Select an action", { exact: false }),
  ).toBeVisible();
  await expect(properties).toHaveCount(0);
  await expect(notes).toHaveCount(0);
  await expect(titleField).toHaveCount(0);
});

test("a saved rename preserves the task selected while the request was pending", async ({
  page,
}) => {
  await signIn(page, "owner");
  const original = "Review drawing scale";
  const revised = "Review revised drawing scale";
  const other = "Check instrument height";
  await submitCapture(page, [original, other].join("\n"));
  await expect(task(page, other)).toBeVisible();
  const rename = /\/commands\/bulk-edit$/;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    rename,
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  const requested = page.waitForRequest(rename);
  const saved = page.waitForResponse(rename);
  try {
    await submitRename(page, original, revised);
    await requested;
    await task(page, other).getByText(other, { exact: true }).click();
    await expect(task(page, other)).toHaveAttribute("aria-selected", "true");
  } finally {
    release();
  }
  expect((await saved).status()).toBe(200);
  await expect(task(page, revised)).toHaveAttribute("aria-selected", "false");
  await expect(task(page, other)).toHaveAttribute("aria-selected", "true");
  await expect(
    inspector(page).getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(other);
});
