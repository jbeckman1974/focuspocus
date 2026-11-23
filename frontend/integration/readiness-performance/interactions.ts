import { expect, type Page } from "@playwright/test";
import { task } from "../../e2e/controls.ts";
import { openPlanning } from "../planning-controls.ts";
import { interaction, type Target } from "./paint.ts";
import { type Evidence, series, switches } from "./evidence.ts";

export const flagged = {
  kind: "outline",
  name: "Flagged",
  count: 1428,
  actions: ["Action 00007", "Action 00014"],
} satisfies Target;
const completed = {
  kind: "outline",
  name: "Completed",
  count: 769,
  actions: ["Action 00013", "Action 00026"],
} satisfies Target;
const bench = {
  kind: "search",
  text: "bench",
  count: 434,
  actions: ["Action 00023", "Action 00046"],
} satisfies Target;
const ledger = {
  kind: "search",
  text: "ledger",
  count: 217,
  actions: ["Action 00046", "Action 00092"],
} satisfies Target;

export async function measureViews(page: Page, evidence: Evidence) {
  function switchTo(target: Extract<Target, { kind: "outline" }>) {
    return interaction(page, "pointerdown", target, () =>
      openPlanning(page, target.name),
    );
  }
  evidence.phase("cold views");
  evidence.observe("firstFlaggedMs", await switchTo(flagged));
  evidence.observe("firstCompletedMs", await switchTo(completed));
  await switches(evidence, [
    { name: "viewFlagged", run: () => switchTo(flagged) },
    { name: "viewCompleted", run: () => switchTo(completed) },
  ]);
  await switchTo(flagged);
}

export async function measureEditing(page: Page, evidence: Evidence) {
  const tree = page.getByRole("tree", { name: "Task outline" });
  const row = task(page, "Action 00007");
  await row.getByText("Action 00007", { exact: true }).click();
  await expect(tree).toBeFocused();
  await series(evidence, "keyboardSelection", 100, (index) => {
    const toGroup = index % 2 === 0;
    return interaction(
      page,
      "keydown",
      { kind: "selection", text: toGroup ? "Group 00001" : "Action 00007" },
      () => page.keyboard.press(toGroup ? "Home" : "ArrowDown"),
    );
  });

  await row.getByText("Action 00007", { exact: true }).dblclick();
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await expect(title).toBeFocused();
  await title.press("End");
  await series(evidence, "inlineTyping", 100, (index) => {
    const append = index % 2 === 0;
    return interaction(
      page,
      "keydown",
      { kind: "editing", value: append ? "Action 00007x" : "Action 00007" },
      () => page.keyboard.press(append ? "x" : "Backspace"),
    );
  });
  await title.press("Escape");
}

export async function measureSearch(page: Page, evidence: Evidence) {
  await openPlanning(page, "Perspectives");
  await page
    .getByLabel("Search scope", { exact: true })
    .selectOption("everything");
  const field = page.getByLabel("Search tasks", { exact: true });
  const switchTo = (target: Extract<Target, { kind: "search" }>) =>
    interaction(page, "beforeinput", target, () => field.fill(target.text));
  evidence.phase("cold note searches");
  evidence.observe("firstBenchSearchMs", await switchTo(bench));
  evidence.observe("firstLedgerSearchMs", await switchTo(ledger));
  await switches(evidence, [
    { name: "searchBench", run: () => switchTo(bench) },
    { name: "searchLedger", run: () => switchTo(ledger) },
  ]);
}
