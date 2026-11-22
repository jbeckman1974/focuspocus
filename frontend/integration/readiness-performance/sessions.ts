import { expect, type Browser, type Page } from "@playwright/test";
import { signIn, submitRename } from "../account.ts";
import { task } from "../../e2e/controls.ts";
import { openPlanning } from "../planning-controls.ts";
import { type Evidence } from "./evidence.ts";
import { armPaint, painted } from "./paint.ts";

const original = "Action 00007";
const renamed = "Action 00007 revised";
const reconnected = "Action 00007 reconciled";

async function rename(writer: Page, from: string, to: string) {
  const received = writer.waitForResponse(
    (response) =>
      response.url().endsWith("/commands/bulk-edit") &&
      response.request().method() === "POST",
  );
  await submitRename(writer, from, to);
  const response = await received;
  expect(response.status()).toBe(200);
  await response.finished();
  // Browser monotonic times are compared on the shared client wall time origin.
  return writer.evaluate(() => {
    const entry = performance
      .getEntriesByType("resource")
      .filter((row) =>
        new URL(row.name).pathname.endsWith("/commands/bulk-edit"),
      )
      .at(-1) as PerformanceResourceTiming | undefined;
    if (!entry?.responseEnd)
      throw new Error("No timing for the acknowledged rename");
    return performance.timeOrigin + entry.responseEnd;
  });
}

async function selectionRetained(page: Page, text: string) {
  return page.evaluate((title) => {
    const tree = document.querySelector(
      '[aria-label="Task outline"][role="tree"]',
    );
    const row = document.getElementById(
      tree?.getAttribute("aria-activedescendant") ?? "",
    );
    return {
      focus: document.activeElement === tree,
      selection:
        row?.getAttribute("aria-selected") === "true" &&
        row.getAttribute("aria-label") === title,
    };
  }, text);
}

export async function convergence(
  writer: Page,
  browser: Browser,
  evidence: Evidence,
) {
  evidence.phase("independent browser convergence");
  // A distinct cookie jar performs a separate ordinary login.
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8000",
    viewport: { width: 1440, height: 900 },
  });
  try {
    const reader = await context.newPage();
    await signIn(reader, "owner");
    for (const page of [writer, reader]) {
      await openPlanning(page, "Flagged");
      await expect(task(page, original)).toBeVisible();
    }
    await task(reader, original).getByText(original, { exact: true }).click();
    await armPaint(reader, null, { kind: "title", text: renamed });
    const acknowledged = await rename(writer, original, renamed);
    await painted(reader);
    const at = await reader.evaluate(
      () => (window as Window & { benchmarkPaintAt: number }).benchmarkPaintAt,
    );
    evidence.record(
      "acknowledgementToSecondSession",
      5000,
      [],
      [Math.max(0, at - acknowledged)],
      "single",
    );
    const onlineSelection = await selectionRetained(reader, renamed);
    evidence.observe("onlineReaderSelection", onlineSelection);
    await context.setOffline(true);
    await expect
      .poll(() => reader.evaluate(() => navigator.onLine))
      .toBe(false);
    await rename(writer, renamed, reconnected);
    await expect(task(reader, renamed)).toBeVisible();
    await armPaint(reader, "online", { kind: "title", text: reconnected });
    await context.setOffline(false);
    evidence.record(
      "reconnectToSecondSession",
      5000,
      [],
      [await painted(reader)],
      "single",
    );
    const reconnectSelection = await selectionRetained(reader, reconnected);
    evidence.observe("reconnectedReaderSelection", reconnectSelection);
    return (
      onlineSelection.focus &&
      onlineSelection.selection &&
      reconnectSelection.focus &&
      reconnectSelection.selection
    );
  } finally {
    await context.close();
  }
}
