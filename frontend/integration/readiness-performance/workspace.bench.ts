import { expect, test } from "@playwright/test";
import { signIn } from "../account.ts";
import { nearestRank, recorder } from "./evidence.ts";
import { measureEditing, measureSearch, measureViews } from "./interactions.ts";
import { convergence, idleClones } from "./sessions.ts";

test("10,000-action authenticated release workspace", async ({
  page,
  browser,
}) => {
  const evidence = recorder(browser.version());
  evidence.phase("cold authenticated startup");
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    window.addEventListener(
      "submit",
      (e) => {
        if (e.isTrusted) performance.mark("benchmark-sign-in");
      },
      { once: true, capture: true },
    );
  });
  await signIn(page, "owner");
  await expect(page.locator(".outline-heading h1")).toHaveText("Inbox");
  const cold = await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const sign = performance.getEntriesByName("benchmark-sign-in")[0];
    if (!sign) throw new Error("Cold sign-in event unavailable");
    const snapshots = performance
      .getEntriesByType("resource")
      .filter((r) =>
        new URL(r.name).pathname.endsWith("/snapshot"),
      ) as PerformanceResourceTiming[];
    return {
      navigationToInboxMs: performance.now(),
      signInToInboxMs: performance.now() - sign.startTime,
      snapshotBytes: snapshots.map((r) => r.decodedBodySize),
      snapshotMs: snapshots.map((r) => r.duration),
    };
  });
  evidence.observe("coldStartup", cold);
  const roundTripMs = await page.evaluate(async () => {
    const times: number[] = [];
    for (let sample = 0; sample < 15; sample++) {
      const start = performance.now();
      const response = await fetch("/api/v1/health/ready", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Health RTT probe failed.");
      await response.arrayBuffer();
      times.push(performance.now() - start);
    }
    return times;
  });
  evidence.observe("httpRoundTrip", {
    samplesMs: roundTripMs,
    p50Ms: nearestRank(roundTripMs, 0.5),
    p95Ms: nearestRank(roundTripMs, 0.95),
  });
  await measureViews(page, evidence);
  await measureEditing(page, evidence);
  await measureSearch(page, evidence);
  const selection = await convergence(page, browser, evidence);
  const idle = await idleClones(page, evidence);
  const overBudget = evidence.finish();
  expect
    .soft(
      selection,
      "Independent reader retained keyboard focus and selection on both refreshes",
    )
    .toBe(true);
  expect
    .soft(
      idle,
      "Idle trusted tab polled its device header without reading the full cached workspace",
    )
    .toBe(true);
  expect(overBudget, "Interaction budgets exceeded").toEqual([]);
});
