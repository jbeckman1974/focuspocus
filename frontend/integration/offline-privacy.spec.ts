import { expect, test, type Page } from "@playwright/test";
import { task } from "../e2e/controls.ts";
import { signIn, submitCapture, withProfile } from "./account.ts";
import { queued, trustDevice, withDevice } from "./offline-device.ts";
import { closeTools, createShared, toolsPanel } from "./workspace-tools.ts";

test("AT-20 · an untrusted browser can reopen its public shell without revealing a previous account", async () => {
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "owner");
    const title = "Private untrusted profile marker";
    await submitCapture(page, title);
    await expect(task(page, title)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const offline = await device.restart(true);
    const response = await offline.goto("/app/");
    expect(response?.ok()).toBe(true);
    await expect(offline.getByRole("heading").first()).toBeVisible();
    await expect(
      offline.getByRole("tree", { name: "Task outline" }),
    ).toHaveCount(0);
    await expect(offline.getByText(title)).toHaveCount(0);
    // Inspect every origin database without depending on FocusPocus store names.
    // The synthetic title must never have reached browser storage without trust.
    const stored = await offline.evaluate(async (marker) => {
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && storage.getItem(key)?.includes(marker)) return true;
        }
      }
      for (const info of await indexedDB.databases()) {
        if (!info.name) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(info.name!);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          for (const name of db.objectStoreNames) {
            const records = await new Promise<unknown[]>((resolve, reject) => {
              const request = db.transaction(name).objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            if (JSON.stringify(records).includes(marker)) return true;
          }
        } finally {
          db.close();
        }
      }
      return false;
    }, title);
    expect(stored).toBe(false);
  });
});

test("AT-20 · cancel or discard on offline sign-out, block the old cookie and protect a second account", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const title = "Private unsent cadastral memo";
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "planner");
    await trustDevice(page);
    const sibling = await page.context().newPage();
    await sibling.goto("/app/");
    await expect(
      sibling.getByRole("tree", { name: "Task outline" }),
    ).toBeVisible();
    await device.connect(false);
    const space = await page.getByLabel("Active workspace").inputValue();
    await submitCapture(page, title);
    await queued(page);
    await expect(
      task(page, title),
      "Durable capture is visible before sign-out",
    ).toBeVisible();
    const signOut = page.getByRole("button", { name: "Sign out", exact: true });
    await signOut.click();
    const decision = page.getByRole("dialog", {
      name: "Pending offline changes",
    });
    await decision.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Active workspace")).toHaveValue(space);
    await queued(page);
    await expect(
      task(page, title),
      "Cancel retains the visible draft in its workspace",
    ).toBeVisible();
    await signOut.click();
    await decision
      .getByRole("button", { name: "Discard changes and sign out" })
      .click();
    await expect(page.getByText(/signed out on this device/i)).toBeVisible();
    await expect(
      sibling.getByRole("tree", { name: "Task outline" }),
    ).toHaveCount(0);
    const locked = await device.restart(true);
    await locked.goto("/app/");
    await expect(locked.getByText(/signed out on this device/i)).toBeVisible();
    await expect(locked.getByText(title)).toHaveCount(0);
    await device.connect(true);
    await expect(
      locked.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await signIn(locked, "neighbor");
    await expect(task(locked, title)).toHaveCount(0);
    await withProfile(browser, "planner", async (peer) => {
      await expect(task(peer, title)).toHaveCount(0);
    });
  });
});

async function invite(owner: Page, recipient: Page, username: string) {
  const sharing = await toolsPanel(owner, "Sharing");
  await sharing.getByLabel("Invite account").fill(username);
  await sharing.getByLabel("Invitation role").selectOption("editor");
  await sharing.getByRole("button", { name: "Create invitation" }).click();
  const code = await sharing
    .getByLabel("New invitation code", { exact: true })
    .inputValue();
  const incoming = await toolsPanel(recipient, "Sharing");
  await incoming.getByLabel("Invitation code", { exact: true }).fill(code);
  await incoming.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    recipient.getByRole("dialog", { name: "Workspace tools" }),
  ).not.toBeVisible();
  await closeTools(owner);
}

test("AT-20 · pending workspace edits cannot cross removal and a fresh grant to the same member", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(120000);
  const title = "Capture from a removed membership";
  const sentinel = "Current grant anchor";
  await signIn(owner, "owner");
  const space = await createShared(owner, "Changing field crew");
  await submitCapture(owner, sentinel);
  await expect(task(owner, sentinel)).toBeVisible();
  await withDevice(async (device) => {
    const member = await device.launch();
    await signIn(member, "neighbor");
    const username = await member.evaluate(
      async () =>
        (await (await fetch("/api/v1/session")).json()).user.username as string,
    );
    await invite(owner, member, username);
    await expect(task(member, sentinel)).toBeVisible();
    await trustDevice(member);
    await device.connect(false);
    await submitCapture(member, title);
    await queued(member);
    const sharing = await toolsPanel(owner, "Sharing");
    await sharing
      .getByRole("button", { name: "Remove " + username, exact: true })
      .click();
    await sharing
      .getByRole("button", { name: "Confirm removal", exact: true })
      .click();
    await expect(sharing.getByLabel("Role for " + username)).toHaveCount(0);
    await withProfile(browser, "neighbor", async (other) => {
      await invite(owner, other, username);
      await expect(task(other, sentinel)).toBeVisible();
    });
    const currentGrant = member.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith(
          "/workspaces/" + space + "/snapshot",
        ) && r.ok(),
    );
    await device.connect(true);
    await currentGrant;
    await expect(task(member, title)).toHaveCount(0, { timeout: 20000 });
    await expect(
      member.getByRole("region", { name: "Offline changes" }).getByText(title),
    ).toHaveCount(0);
    await expect(task(owner, title)).toHaveCount(0);
    await member.reload();
    await expect(
      member.getByRole("tree", { name: "Task outline" }),
    ).toBeVisible();
    await expect(task(member, title)).toHaveCount(0);
  });
});

test("AT-20 · an expired session hides offline drafts until the same principal signs in again", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const title = "Recover the disconnected log";
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "owner");
    await trustDevice(page);
    await device.connect(false);
    await submitCapture(page, title);
    await queued(page);
    await page.context().clearCookies({ name: "sessionid" });
    await page.route(/\/api\/v1\/session$/, (route) =>
      route.abort("connectionreset"),
    );
    const denied = page.waitForResponse(
      (response) =>
        response.status() === 401 &&
        new URL(response.url()).pathname.startsWith("/api/v1/"),
    );
    await device.connect(true);
    await denied;
    await expect(page.getByRole("tree", { name: "Task outline" })).toHaveCount(
      0,
      { timeout: 20000 },
    );
    // The following /session request cannot succeed. A cold offline boot must
    // already respect the 401 while retaining the same actor's unreadable queue.
    const locked = await device.restart(true);
    await locked.goto("/app/");
    await expect(locked.getByRole("heading")).toBeVisible();
    await expect(locked.getByText(title)).toHaveCount(0);
    await expect(
      locked.getByRole("tree", { name: "Task outline" }),
    ).toHaveCount(0);
    await device.connect(true);
    await expect(
      locked.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await withProfile(browser, "owner", async (peer) => {
      await expect(task(peer, title)).toHaveCount(0);
      await signIn(locked, "owner");
      await expect(task(peer, title)).toHaveCount(1, { timeout: 20000 });
      await expect(task(locked, title)).toBeVisible();
    });
  });
});
