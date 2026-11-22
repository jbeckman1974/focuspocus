import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createOfflineNetwork } from "./offline-network.ts";

export async function withDevice(
  exercise: (device: {
    launch: (offline?: boolean) => Promise<Page>;
    restart: (offline?: boolean) => Promise<Page>;
    connect: (online: boolean) => Promise<void>;
    network: Awaited<ReturnType<typeof createOfflineNetwork>>;
  }) => Promise<void>,
) {
  const profile = await mkdtemp(join(tmpdir(), "focuspocus-chromium-"));
  const network = await createOfflineNetwork();
  let context: BrowserContext | undefined;
  async function launch(offline = false) {
    network.online(!offline);
    context = await chromium.launchPersistentContext(profile, {
      baseURL: network.origin,
      offline,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
      reducedMotion: "reduce",
    });
    context.setDefaultTimeout(12000);
    return context.pages()[0] ?? (await context.newPage());
  }
  try {
    await exercise({
      network,
      launch,
      async restart(offline = false) {
        // Closing a persistent context closes its Chromium process.
        await context!.close();
        return launch(offline);
      },
      async connect(online) {
        network.online(online);
        await context!.setOffline(!online);
      },
    });
  } finally {
    try {
      await context?.close();
    } finally {
      await network.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
}

export async function trustDevice(page: Page) {
  await page
    .getByRole("button", { name: "Enable offline editing on this device" })
    .click();
  await expect(
    page.getByText("Offline editing enabled on this device.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

export async function queued(page: Page) {
  await expect(
    page
      .getByRole("region", { name: "Offline changes" })
      .getByRole("listitem")
      .first(),
  ).toBeVisible();
}
