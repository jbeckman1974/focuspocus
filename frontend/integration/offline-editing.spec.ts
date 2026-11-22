import { expect, test, type Page } from "@playwright/test";
import { sidebarDestination, task, taskId } from "../e2e/controls.ts";
import { createDestination, signIn, submitCapture, submitRename, withProfile } from "./account.ts";
import { queued, trustDevice, withDevice } from "./offline-device.ts";
import { createShared, selectWorkspace } from "./workspace-tools.ts";

async function moveTask(page: Page, title: string, destination: string) {
  await task(page, title).getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Move…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move tasks" });
  await dialog.getByLabel("Move to", { exact: true }).selectOption({ label: destination });
  await dialog.getByRole("button", { name: "Move tasks", exact: true }).click();
}

async function trash(page: Page, title: string) {
  await task(page, title).getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Organize…", exact: true }).click();
  await page.getByRole("dialog", { name: "Organize workspace" }).getByRole("button", { name: "Move to Trash", exact: true }).click();
}

test("AT-19 · restart Chromium offline and deliver a task hierarchy and dependent changes exactly once", async ({ browser }) => {
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
    const inbox = (workspace: Page) => workspace.getByRole("navigation", { name: "Perspectives" }).getByRole("button", { name: "Inbox", exact: true });
    await inbox(page).click();
    await submitCapture(page, existing + "\n" + unwanted);
    const existingId = await taskId(page, existing);
    await trustDevice(page);
    await device.connect(false);
    await submitCapture(page, parent + "\n" + child);
    const parentId = await taskId(page, parent);
    const childId = await taskId(page, child);
    await task(page, child).getByText(child, { exact: true }).click();
    await page.getByRole("button", { name: "Outline commands" }).click();
    await page.getByRole("button", { name: "Indent", exact: true }).click();
    await expect(task(page, child)).toHaveAttribute("aria-level", "2");
    await submitRename(page, child, renamed);
    await expect(task(page, renamed)).toHaveAttribute("data-task-id", childId);
    await trash(page, unwanted);
    await expect(task(page, unwanted)).toHaveCount(0);
    await moveTask(page, existing, project);
    await queued(page);

    const reopened = await device.restart(true);
    await reopened.goto("/app/");
    await inbox(reopened).click();
    await expect(task(reopened, parent)).toHaveAttribute("data-task-id", parentId);
    await expect(task(reopened, renamed)).toHaveAttribute("aria-level", "2");
    await expect(task(reopened, unwanted)).toHaveCount(0);
    await sidebarDestination(reopened, project).click();
    await expect(task(reopened, existing)).toHaveAttribute("data-task-id", existingId);

    await withProfile(browser, "planner", async (peer) => {
      await selectWorkspace(peer, space);
      await expect(task(peer, parent)).toHaveCount(0);
      await expect(task(peer, unwanted)).toBeVisible();
      await device.connect(true);
      await expect(task(peer, renamed)).toHaveAttribute("data-task-id", childId, { timeout: 30000 });
      await expect(task(peer, parent)).toHaveAttribute("data-task-id", parentId);
      await expect(task(peer, renamed)).toHaveAttribute("aria-level", "2");
      await expect(task(peer, unwanted)).toHaveCount(0, { timeout: 20000 });
      await sidebarDestination(peer, project).click();
      await expect(task(peer, existing)).toHaveAttribute("data-task-id", existingId, { timeout: 20000 });
    });
  });
});

test("AT-18/19 · a lost committed response replays the same operation after offline restart", async ({ browser }) => {
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
    await expect.poll(device.network.wasInterrupted, { timeout: 20000 }).toBe(true);
    expect(device.network.statuses).toEqual([200]);
    await withProfile(browser, "owner", async (peer) => {
      await expect(task(peer, title)).toHaveAttribute("data-task-id", id);
      const reopened = await device.restart(true);
      await reopened.goto("/app/");
      await expect(task(reopened, title)).toHaveAttribute("data-task-id", id);
      await device.connect(true);
      await expect.poll(() => device.network.statuses, { timeout: 20000 }).toEqual([200, 200]);
      expect(device.network.identities).toHaveLength(2);
      expect(new Set(device.network.identities).size).toBe(1);
      await peer.reload();
      await expect(task(peer, title)).toHaveCount(1);
      await expect(task(peer, title)).toHaveAttribute("data-task-id", id);
    });
  });
});

test("AT-18/19 · a remote deletion holds dependent edits while an independent capture reaches the server", async ({ browser }) => {
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
      await expect(changes.getByRole("button", { name: "Discard change" }).first()).toBeVisible({ timeout: 20000 });
      await expect(changes).toContainText(revision);
      await expect(changes).toContainText(dependent);
      await expect(task(peer, separate)).toHaveCount(1, { timeout: 20000 });
      await expect(task(peer, original)).toHaveCount(0);
      await expect(task(peer, dependent)).toHaveCount(0);
    });
  });
});
