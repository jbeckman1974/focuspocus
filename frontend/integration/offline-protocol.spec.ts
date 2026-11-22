import { expect, test } from "@playwright/test";
import { task } from "../e2e/controls.ts";
import { signIn, submitCapture, withProfile } from "./account.ts";
import { queued, trustDevice, withDevice } from "./offline-device.ts";

test("AT-20 · an unsupported server protocol offers deliberate draft review after real reauthorization", async ({
  browser,
}) => {
  test.setTimeout(90000);
  await withDevice(async (device) => {
    const page = await device.launch();
    const keep = "Reapply after a compatible upgrade";
    const discard = "Discard after an incompatible upgrade";
    await signIn(page, "planner");
    await trustDevice(page);
    await device.connect(false);
    await submitCapture(page, discard);
    await queued(page);
    await submitCapture(page, keep);
    const snapshot = /\/workspaces\/[^/]+\/snapshot(?:\?|$)/;
    await page.route(snapshot, async (route) => {
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      const body = await result.json();
      body.offlineGrant.protocol = 2;
      await route.fulfill({ response: result, json: body });
    });
    await device.connect(true);
    const changes = page.getByRole("region", { name: "Offline changes" });
    const row = (title: string) =>
      changes.getByRole("listitem").filter({ hasText: title });
    await expect(
      row(discard).getByRole("button", { name: "Discard change" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      changes.getByRole("button", { name: "Reapply change" }),
    ).toHaveCount(0);
    await expect(page.getByRole("tree", { name: "Task outline" })).toHaveCount(
      0,
    );
    await row(discard).getByRole("button", { name: "Discard change" }).click();
    await expect(row(discard)).toHaveCount(0);
    await expect(row(keep)).toBeVisible();
    await withProfile(browser, "planner", async (peer) => {
      await expect(task(peer, keep)).toHaveCount(0);
      await expect(task(peer, discard)).toHaveCount(0);
      await page.unroute(snapshot);
      await page.getByRole("button", { name: "Retry connection" }).click();
      await row(keep)
        .getByRole("button", { name: "Reapply change" })
        .click({ timeout: 20000 });
      await expect(task(peer, keep)).toHaveCount(1, { timeout: 20000 });
      await expect(task(peer, discard)).toHaveCount(0);
    });
  });
});
