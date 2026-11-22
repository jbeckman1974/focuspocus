import { expect, test } from "@playwright/test";
import { task, taskId } from "../e2e/controls.ts";
import { signIn, submitCapture, submitRename, withProfile } from "./account.ts";

const workspaceWrites =
  /\/api\/v1\/workspaces\/[^/]+\/(?:commands\/[^/?]+|items\/[^/?]+)\/?$/;

test("AT-18 · retry a capture after the database commits but the acknowledgement is lost", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner");
  await withProfile(browser, "owner", async (observer) => {
    const envelopes: string[] = [];
    await page.route(workspaceWrites, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      envelopes.push(route.request().postData() ?? "");
      if (envelopes.length !== 1) return route.continue();
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.abort("connectionreset");
    });
    const title = "Acknowledged once";
    await submitCapture(page, title);
    await expect(
      page.getByRole("button", { name: "Retry original change" }),
    ).toBeVisible();
    await expect(task(observer, title)).toHaveCount(1, { timeout: 5000 });
    const committedId = await taskId(observer, title);
    await page.getByRole("button", { name: "Retry original change" }).click();
    await expect(
      page.getByRole("button", { name: "Retry original change" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "New project", exact: true }),
    ).toBeEnabled();
    await expect(task(page, title)).toHaveAttribute(
      "data-task-id",
      committedId,
    );
    expect(envelopes.length).toBe(2);
    expect(envelopes[0].length > 0 && envelopes[0] === envelopes[1]).toBe(true);
    await page.reload();
    await expect(task(page, title)).toHaveCount(1);
    await expect(task(page, title)).toHaveAttribute(
      "data-task-id",
      committedId,
    );
  });
});

test("AT-18 · stale editors retain their draft and deliberately reapply it", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner");
  const original = "Competing rename";
  const winning = "First saved title";
  const draft = "Second desired title";
  await submitCapture(page, original);
  const itemId = await taskId(page, original);
  await withProfile(browser, "owner", async (other) => {
    await expect(task(other, original)).toHaveAttribute("data-task-id", itemId);
    let received!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      received = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    let intercepted = false;
    await page.route(workspaceWrites, async (route) => {
      const write = ["PATCH", "POST"].includes(route.request().method());
      if (write && !intercepted) {
        intercepted = true;
        received();
        await resume;
      }
      await route.continue();
    });
    try {
      await submitRename(page, original, draft);
      await held;
      await submitRename(other, original, winning);
      await expect(task(other, winning)).toHaveAttribute(
        "data-task-id",
        itemId,
      );
    } finally {
      release();
    }
    const reapply = page.getByRole("button", { name: "Reapply my change" });
    await expect(reapply).toBeVisible();
    await expect(
      page.getByText(`Your change: ${draft}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Current task: ${winning}`, { exact: false }),
    ).toBeVisible();
    await expect(task(other, winning)).toHaveAttribute("data-task-id", itemId);
    await reapply.click();
    await expect(reapply).toHaveCount(0);
    await expect(task(other, draft)).toHaveAttribute("data-task-id", itemId, {
      timeout: 5000,
    });
    await other.reload();
    await expect(task(other, draft)).toHaveAttribute("data-task-id", itemId);
  });
});
