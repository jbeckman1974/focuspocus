import { expect, type Page } from "@playwright/test";
import { trustDevice } from "../offline-device.ts";
import type { Evidence } from "./evidence.ts";

interface Read {
  store: string;
  startMs: number;
  latencyMs: number;
}

export async function idleClones(page: Page, evidence: Evidence) {
  evidence.phase("trusted idle-tab reads");
  await trustDevice(page);
  const idle = await page.context().newPage();
  try {
    await idle.addInitScript(() => {
      const reads: Read[] = [];
      (window as Window & { benchmarkReads?: Read[] }).benchmarkReads = reads;
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        const startMs = performance.now();
        const request = get.call(this, key);
        if (this.transaction.db.name === "focuspocus-trusted-device") {
          // Do not touch .result here; deserializing it would change the workload.
          request.addEventListener(
            "success",
            () =>
              reads.push({
                store: this.name,
                startMs,
                latencyMs: performance.now() - startMs,
              }),
            { once: true },
          );
        }
        return request;
      };
    });
    await idle.goto("/app/");
    await expect(
      idle.getByText("Offline editing enabled on this device.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      idle.getByRole("tree", { name: "Task outline" }),
    ).toBeVisible();
    const reads = () =>
      idle.evaluate(() => {
        const events = (window as Window & { benchmarkReads?: Read[] })
          .benchmarkReads;
        if (!events)
          throw new Error("Idle-tab read instrumentation is missing");
        return events;
      });
    await expect
      .poll(async () => (await reads()).some((r) => r.store === "workspaces"))
      .toBe(true);
    // Enrollment/cold hydration is recorded separately; then let two normal feed
    // polls settle before the six-second idle window. No mock clocks or fake changes.
    let polls = 0;
    const settled = idle.waitForResponse((response) => {
      if (
        response.ok() &&
        new URL(response.url()).pathname.endsWith("/changes")
      )
        polls++;
      return polls >= 2;
    });
    await settled;
    const start = await idle.evaluate(() => performance.now());
    const startup = (await reads()).filter(
      (r) => r.store === "workspaces" && r.startMs < start,
    );
    await page.bringToFront();
    const elapsed = await idle.evaluate(async () => {
      const start = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return performance.now() - start;
    });
    const windowReads = (await reads()).filter((r) => r.startMs >= start);
    evidence.observe("trustedTab", {
      startupWorkspaceReadMs: startup.map((r) => r.latencyMs),
      observationMs: elapsed,
      idleProfileReadMs: windowReads
        .filter((r) => r.store === "profile")
        .map((r) => r.latencyMs),
      idleWorkspaceReadMs: windowReads
        .filter((r) => r.store === "workspaces")
        .map((r) => r.latencyMs),
    });
    return (
      windowReads.some((r) => r.store === "profile") &&
      !windowReads.some((r) => r.store === "workspaces")
    );
  } finally {
    await idle.close();
  }
}
