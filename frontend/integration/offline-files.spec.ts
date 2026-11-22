import { expect, test, type Page } from "@playwright/test";
import { inspector, task } from "../e2e/controls.ts";
import { signIn, submitCapture, withProfile } from "./account.ts";
import { trustDevice, withDevice } from "./offline-device.ts";

async function filesFor(page: Page, taskName: string) {
  await task(page, taskName).getByText(taskName, { exact: true }).click();
  await inspector(page)
    .getByRole("button", { name: "Notes and files…" })
    .click();
  return page.getByRole("dialog", { name: "Notes and files" });
}

test("AT-19/25 · cold restart retains staged bytes, refuses a partial upload and retries the same file once", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const title = "Archive the benchmark drawing";
  const filename = "field-note.txt";
  const bytes = Buffer.from("Synthetic field note.\n".repeat(256));
  await withDevice(async (device) => {
    const page = await device.launch();
    await signIn(page, "neighbor");
    await submitCapture(page, title);
    await expect(task(page, title)).toBeVisible();
    await trustDevice(page);
    await device.connect(false);
    const dialog = await filesFor(page, title);
    await dialog.getByLabel("Attach file", { exact: true }).setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: bytes,
    });
    await dialog
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await expect(dialog).toContainText("File saved on this device for sync.");
    const reopened = await device.restart(true);
    await reopened.goto("/app/");
    await expect(task(reopened, title)).toBeVisible();
    device.network.interrupt(
      /\/content\/items\/[^/]+\/files$/,
      "partial-upload",
    );
    await device.connect(true);
    await expect
      .poll(device.network.wasInterrupted, { timeout: 20000 })
      .toBe(true);
    expect(device.network.bytesForwarded()).toBeGreaterThan(0);
    expect(device.network.bytesForwarded()).toBeLessThan(bytes.length);
    await withProfile(browser, "neighbor", async (peer) => {
      const before = await filesFor(peer, title);
      await expect(
        before.getByLabel("Attach file", { exact: true }),
      ).toBeVisible();
      await expect(
        before.getByRole("link", { name: "Download " + filename }),
      ).toHaveCount(0);
      await before.getByRole("button", { name: "Close", exact: true }).click();
      const retry = await device.restart(true);
      await retry.goto("/app/");
      await expect(task(retry, title)).toBeVisible();
      await device.connect(true);
      await expect
        .poll(() => device.network.statuses, { timeout: 30000 })
        .toEqual([200]);
      expect(device.network.identities).toHaveLength(2);
      expect(new Set(device.network.identities).size).toBe(1);
      const complete = await filesFor(peer, title);
      const link = complete.getByRole("link", {
        name: "Download " + filename,
        exact: true,
      });
      await expect(link).toHaveCount(1);
      const href = await link.getAttribute("href");
      if (!href) throw new Error("Uploaded file has no download URL.");
      const actual = await peer.request.get(href);
      expect(actual.status()).toBe(200);
      expect((await actual.body()).equals(bytes)).toBe(true);
    });
  });
});
