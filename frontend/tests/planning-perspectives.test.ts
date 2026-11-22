import test from "node:test";
import assert from "node:assert/strict";
import {
  childrenOf,
  defaultValue,
  group,
  newDefinition,
  toggleId,
} from "../src/persistent/planning/perspective.ts";
import { planningLinks } from "../src/persistent/planning/links.ts";
import { prepare } from "../src/persistent/writes.ts";
import { formatCalendarDay } from "../src/persistent/schedule.ts";
import type { Snapshot } from "../src/persistent/api.ts";

test("perspective groups preserve nested exclusions and edit copies only", () => {
  const first = newDefinition();
  first.expression = group("all", [
    { field: "availability", value: "remaining" },
    group("any", [
      { field: "flagged", value: true },
      { field: "tag", value: "field" },
    ]),
    group("none", [{ field: "tag", value: "wait" }]),
  ]);
  const branch = childrenOf(first.expression)!;
  assert.equal(branch[0], "all");
  assert.equal(branch[1].length, 3);
  assert.equal(childrenOf(branch[1][2])?.[0], "none");
  assert.deepEqual(defaultValue("due", [], []), true);
  assert.deepEqual(defaultValue("tag", ["field"], []), "field");
  assert.deepEqual(defaultValue("duration", [], []), { min: 0 });
  assert.deepEqual(toggleId(["project"], "project"), []);
  assert.deepEqual(newDefinition().expression, {
    all: [{ field: "availability", value: "remaining" }],
  });
});
test("only favorite saved perspectives appear on the rail, by stable identity", () => {
  const view = {
    version: 1,
    definition: newDefinition(),
    id: "one",
    name: "Daily",
    icon: "clock",
    favorite: true,
  };
  const links = planningLinks({
    personalVersion: 2,
    focusIds: [],
    perspectives: [view, { ...view, id: "two", favorite: false }],
  });
  assert.deepEqual(
    links.map((item) => item.id),
    ["forecast", "review", "perspectives", "saved-one"],
  );
  assert.equal(links.at(-1)?.icon, "changed");
});
test("a review near midnight displays the calendar day in the queue's timezone", () => {
  const instant = "2026-11-22T07:30:00Z";
  const utc = new Intl.DateTimeFormat(undefined, { timeZone: "UTC" });
  assert.equal(
    formatCalendarDay(instant, "America/Los_Angeles"),
    utc.format(new Date("2026-11-21T12:00:00Z")),
  );
  assert.equal(
    formatCalendarDay(instant, "America/New_York"),
    utc.format(new Date("2026-11-22T12:00:00Z")),
  );
});

test("review writes use the shared guarded command envelope and project version", () => {
  const base: Snapshot = {
    workspaceId: "w",
    revision: 4,
    context: "test",
    generation: "seed",
    cursor: "c",
    tags: [],
    projects: [],
    tasks: [],
  };
  const marked = prepare(
    {
      type: "planning-review",
      name: "mark-reviewed",
      payload: { projectId: "p", expectedVersion: 3 },
    },
    base,
    () => "op",
  );
  assert.deepEqual(marked.envelope, {
    operationId: "op",
    context: "test",
    expectedRevision: 4,
    payload: { projectId: "p", expectedVersion: 3 },
  });
  assert.equal(marked.name, "mark-reviewed");
});
