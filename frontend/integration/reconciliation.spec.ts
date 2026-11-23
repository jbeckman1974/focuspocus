import { expect, test as base } from "@playwright/test";
import { activate, task, taskId } from "../e2e/controls.ts";
import { signIn, submitCapture, submitRename, withProfile } from "./account.ts";
import { createOfflineNetwork } from "./offline-network.ts";

const test = base.extend<{
  network: Awaited<ReturnType<typeof createOfflineNetwork>>;
}>({
  network: async ({}, use) => {
    const network = await createOfflineNetwork();
    try {
      await use(network);
    } finally {
      await network.close();
    }
  },
});

const workspaceWrites =
  /\/api\/v1\/workspaces\/[^/]+\/(?:commands\/[^/?]+|items\/[^/?]+)\/?$/;

test("AT-18 · retry a capture after the database commits but the acknowledgement is lost", async ({
  page,
  browser,
  network,
}) => {
  await signIn(page, "owner", network.origin + "/app/");
  await withProfile(browser, "owner", async (observer) => {
    network.interrupt(workspaceWrites, "after-commit");
    const title = "Acknowledged once";
    await page.bringToFront();
    await submitCapture(page, title);
    await expect(
      page.getByRole("button", { name: "Retry original change" }),
    ).toBeVisible();
    const notice = page.getByRole("region", { name: "Pending change" });
    await expect(notice.getByRole("alert")).toHaveText(/\S/);
    await expect(task(observer, title)).toHaveCount(1, { timeout: 5000 });
    const committedId = await taskId(observer, title);
    expect(network.statuses).toEqual([200]);
    network.online(true);
    await activate(
      page,
      notice.getByRole("button", { name: "Retry original change" }),
    );
    await expect(
      page.getByRole("button", { name: "Retry original change" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tree", { name: "Task outline" }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "New project", exact: true }),
    ).toBeEnabled();
    await expect(task(page, title)).toHaveAttribute(
      "data-task-id",
      committedId,
    );
    expect(network.statuses).toEqual([200, 200]);
    expect(network.identities).toHaveLength(2);
    expect(network.identities[1]).toBe(network.identities[0]);
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
  network,
}) => {
  await signIn(page, "owner", network.origin + "/app/");
  const original = "Competing rename";
  const winning = "First saved title";
  const draft = "Second desired title";
  await submitCapture(page, original);
  const itemId = await taskId(page, original);
  await withProfile(browser, "owner", async (other) => {
    await expect(task(other, original)).toHaveAttribute("data-task-id", itemId);
    const gate = network.holdNextWrite(workspaceWrites);
    try {
      await page.bringToFront();
      await submitRename(page, original, draft);
      await gate.received;
      await other.bringToFront();
      await submitRename(other, original, winning);
      await expect(task(other, winning)).toHaveAttribute(
        "data-task-id",
        itemId,
      );
    } finally {
      gate.release();
    }
    const reapply = page.getByRole("button", { name: "Reapply my change" });
    await expect(reapply).toBeVisible();
    const notice = page.getByRole("region", { name: "Pending change" });
    await expect(notice.getByRole("alert")).toHaveText(/\S/);
    await expect(
      page.getByText(`Your change: ${draft}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Current task: ${winning}`, { exact: false }),
    ).toBeVisible();
    await expect(task(other, winning)).toHaveAttribute("data-task-id", itemId);
    await activate(page, reapply);
    await expect(reapply).toHaveCount(0);
    await expect(
      page.getByRole("tree", { name: "Task outline" }),
    ).toBeFocused();
    await expect(task(other, draft)).toHaveAttribute("data-task-id", itemId, {
      timeout: 5000,
    });
    await other.reload();
    await expect(task(other, draft)).toHaveAttribute("data-task-id", itemId);
  });
});
