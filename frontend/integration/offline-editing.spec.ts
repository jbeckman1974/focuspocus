import { expect, test, type Page } from "@playwright/test";
import { sidebarDestination, task, taskId } from "../e2e/controls.ts";
import {
  createDestination,
  signIn,
  submitCapture,
  submitRename,
  withProfile,
} from "./account.ts";
import { queued, trustDevice, withDevice } from "./offline-device.ts";
import { createShared, selectWorkspace } from "./workspace-tools.ts";

async function moveTask(page: Page, title: string, destination: string) {
  await task(page, title).getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Move…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move tasks" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Move to" })
    .selectOption({ label: destination });
  await dialog.getByRole("button", { name: "Move tasks", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function trash(page: Page, title: string) {
  await task(page, title).getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Organize…", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Organize workspace" })
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
}

test("AT-19 · restart Chromium offline and deliver a task hierarchy and dependent changes exactly once", async ({
  browser,
}) => {
  test.setTimeout(120000);
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "planner");
    const space = await createShared(page, "Offline field crew");
    const project = "Field project";
    const existing = "Move the level";
    const unwanted = "Discard blank card";
    const parent = "Traverse";
    const child = "Record foresight";
    const renamed = "Record foresight and backsight";
    await createDestination(page, "project", project);
    const inbox = (workspace: Page) =>
      workspace
        .getByRole("navigation", { name: "Perspectives" })
        .getByRole("button", { name: "Inbox", exact: true });
    await inbox(page).click();
    await submitCapture(page, existing + "\n" + unwanted);
    const existingId = await taskId(page, existing);
    await trustDevice(page);
    await device.connect(false);
    await test.step(
      "Capture the parent and child during the outage",
      () => submitCapture(page, parent + "\n" + child),
      { timeout: 15000 },
    );
    const parentId = await taskId(page, parent);
    const childId = await taskId(page, child);
    await test.step(
      "Indent and rename the pending child",
      async () => {
        await task(page, child).getByText(child, { exact: true }).click();
        await page.getByRole("button", { name: "Outline commands" }).click();
        await page.getByRole("button", { name: "Indent", exact: true }).click();
        await expect(task(page, child)).toHaveAttribute("aria-level", "2");
        await submitRename(page, child, renamed);
        await expect(task(page, renamed)).toHaveAttribute(
          "data-task-id",
          childId,
        );
      },
      { timeout: 16000 },
    );
    await test.step(
      "Trash a saved task and move its sibling to the project",
      async () => {
        await trash(page, unwanted);
        await expect(task(page, unwanted)).toHaveCount(0);
        await moveTask(page, existing, project);
        await expect(
          page
            .getByRole("region", { name: "Offline changes" })
            .getByText("Move to " + project, { exact: true }),
        ).toBeVisible();
        await sidebarDestination(page, project).click();
        await expect(
          task(page, existing),
          "The stored move is visible before shutdown",
        ).toHaveAttribute("data-task-id", existingId);
      },
      { timeout: 16000 },
    );

    const reopened = await test.step(
      "Close and relaunch the browser while disconnected",
      () => device.restart(true),
      { timeout: 15000 },
    );
    await reopened.goto("/app/");
    await inbox(reopened).click();
    await expect(task(reopened, parent)).toHaveAttribute(
      "data-task-id",
      parentId,
    );
    await expect(task(reopened, renamed)).toHaveAttribute("aria-level", "2");
    await expect(task(reopened, unwanted)).toHaveCount(0);
    await sidebarDestination(reopened, project).click();
    await expect(task(reopened, existing)).toHaveAttribute(
      "data-task-id",
      existingId,
    );

    await withProfile(browser, "planner", async (peer) => {
      await selectWorkspace(peer, space);
      await expect(task(peer, parent)).toHaveCount(0);
      await expect(task(peer, unwanted)).toBeVisible();
      await device.connect(true);
      await expect(task(peer, renamed)).toHaveAttribute(
        "data-task-id",
        childId,
        { timeout: 30000 },
      );
      await expect(task(peer, parent)).toHaveAttribute(
        "data-task-id",
        parentId,
      );
      await expect(task(peer, renamed)).toHaveAttribute("aria-level", "2");
      await expect(task(peer, unwanted)).toHaveCount(0, { timeout: 20000 });
      await sidebarDestination(peer, project).click();
      await expect(task(peer, existing)).toHaveAttribute(
        "data-task-id",
        existingId,
        { timeout: 20000 },
      );
    });
  });
});

test("AT-18/19 · a lost committed response replays the same operation after offline restart", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const title = "Retain one benchmark";
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "owner");
    await trustDevice(page);
    await device.connect(false);
    await submitCapture(page, title);
    const id = await taskId(page, title);
    await queued(page);
    device.network.interrupt(/\/commands\/capture$/, "after-commit");
    await device.connect(true);
    await expect
      .poll(device.network.wasInterrupted, { timeout: 20000 })
      .toBe(true);
    expect(device.network.statuses).toEqual([200]);
    await withProfile(browser, "owner", async (peer) => {
      await expect(task(peer, title)).toHaveAttribute("data-task-id", id);
      const reopened = await device.restart(true);
      await reopened.goto("/app/");
      await expect(task(reopened, title)).toHaveAttribute("data-task-id", id);
      await device.connect(true);
      await expect
        .poll(() => device.network.statuses, { timeout: 20000 })
        .toEqual([200, 200]);
      expect(device.network.identities).toHaveLength(2);
      expect(new Set(device.network.identities).size).toBe(1);
      await peer.reload();
      await expect(task(peer, title)).toHaveCount(1);
      await expect(task(peer, title)).toHaveAttribute("data-task-id", id);
    });
  });
});

test("AT-18/19 · a remote deletion holds dependent edits while an independent capture reaches the server", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const original = "Collect parcel tie";
  const revision = "Collect east parcel tie";
  const dependent = "Collect east parcel tie twice";
  const separate = "File a separate report";
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "planner");
    const space = await createShared(page, "Field corrections");
    await submitCapture(page, original);
    await expect(task(page, original)).toBeVisible();
    await trustDevice(page);
    await device.connect(false);
    await submitRename(page, original, revision);
    await submitRename(page, revision, dependent);
    await submitCapture(page, separate);
    await queued(page);
    await withProfile(browser, "planner", async (peer) => {
      await selectWorkspace(peer, space);
      await trash(peer, original);
      await expect(task(peer, original)).toHaveCount(0);
      await device.connect(true);
      const changes = page.getByRole("region", { name: "Offline changes" });
      await expect(
        changes.getByRole("button", { name: "Discard change" }).first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(changes).toContainText(revision);
      await expect(changes).toContainText(dependent);
      await expect(task(peer, separate)).toHaveCount(1, { timeout: 20000 });
      await expect(task(peer, original)).toHaveCount(0);
      await expect(task(peer, dependent)).toHaveCount(0);
      const held = (title: string) =>
        changes.getByRole("listitem").filter({
          has: page
            .locator("strong")
            .filter({ hasText: new RegExp("^" + title + "$") }),
        });
      await held(revision)
        .getByRole("button", { name: "Discard change" })
        .click();
      await expect(held(revision)).toHaveCount(0);
      await held(dependent)
        .getByRole("button", { name: "Discard change" })
        .click();
      await expect(changes.getByRole("listitem")).toHaveCount(0);
      await expect(task(peer, separate)).toHaveCount(1);
      await expect(task(peer, dependent)).toHaveCount(0);
    });
  });
});
