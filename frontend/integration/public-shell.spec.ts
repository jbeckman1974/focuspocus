import { expect, test } from "@playwright/test";
import { signIn } from "./account.ts";

test("the installed shell opens offline and keeps authenticated responses out of Cache Storage", async ({
  page,
  context,
}) => {
  await signIn(page, "neighbor");
  const manifest = await page.request.get("/app/manifest.webmanifest");
  expect(await manifest.json()).toMatchObject({
    start_url: "/app/",
    scope: "/app/",
    display: "standalone",
  });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    )
    .toContain("/app/sw.js");
  const keys = await page.evaluate(async () => {
    await fetch("/api/v1/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const all = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        all.push(new URL(request.url).pathname);
    }
    return all;
  });
  expect(keys).toContain("/app/");
  expect(keys).toContain("/app/icon-512.png");
  expect(keys.some((path) => path.endsWith(".css"))).toBe(true);
  expect(
    keys.every(
      (path) =>
        /^\/assets\/[\w-]+\.(js|css|svg|woff2)$/.test(path) ||
        [
          "/app/",
          "/app/icon-192.png",
          "/app/icon-512.png",
          "/app/manifest.webmanifest",
        ].includes(path),
    ),
  ).toBe(true);
  await context.setOffline(true);
  try {
    const response = await page.reload({ waitUntil: "domcontentloaded" });
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.locator("#root > *")).not.toHaveCount(0);
    const privateRead = await page.evaluate(async () => {
      try {
        await fetch("/api/v1/session", { cache: "no-store" });
        return true;
      } catch {
        return false;
      }
    });
    expect(privateRead).toBe(false);
  } finally {
    await context.setOffline(false);
  }
});
