import assert from "node:assert/strict";
import test from "node:test";
import { taskDueDay } from "../src/components/presentations/calendarDates.ts";
import { newTask } from "../src/outline/values.ts";
import type { Snapshot } from "../src/persistent/api.ts";
import { enqueue } from "../src/persistent/offline/queue.ts";
import {
  project,
  restoreProjection,
} from "../src/persistent/offline/queueProjection.ts";
import type { QueueEntry } from "../src/persistent/offline/queueTypes.ts";
import { freshData } from "../src/persistent/offline/storeTypes.ts";
import {
  effectiveDue,
  type DateIntent,
  type EffectiveDate,
} from "../src/persistent/schedule.ts";
import { prepare, type Intent } from "../src/persistent/writes.ts";

const zone = "America/New_York";
const initial: Snapshot = {
  workspaceId: "work",
  context: "ctx",
  cursor: "cursor",
  generation: "g",
  offlineGrant: {
    id: "fixture-grant",
    protocol: 1,
    expiresAt: "2099-01-01T00:00:00Z",
  },
  revision: 5,
  timeZone: "UTC",
  viewZone: zone,
  dateDefaults: { defer: "00:00", planned: "00:00", due: "17:00" },
  assignmentDueTime: "08:30",
  tasks: [],
  projects: [],
  tags: [],
};
const day = (value: string): DateIntent => ({
  kind: "date",
  value,
  defaultTime: "17:00",
});
const source = (
  id: string,
  value: DateIntent,
  instant: string,
): EffectiveDate => ({ source: id, value, instant });
function row(
  id: string,
  direct?: DateIntent,
  due?: EffectiveDate,
  parentId = "inbox",
): Snapshot["tasks"][number] {
  return {
    ...newTask(id, parentId, id),
    version: 1,
    due: direct?.value.slice(0, 10) ?? null,
    schedule: direct ? { due: direct } : {},
    effective: {
      status: "active",
      flagged: false,
      flagSource: null,
      remaining: true,
      available: true,
      firstAvailable: false,
      blocked: false,
      reason: null,
      reasonSource: null,
      schedule: due ? { due } : {},
    },
  };
}
function apply(base: Snapshot, intent: Intent) {
  return project(base, prepare(intent, base));
}
function item(base: Snapshot, id: string) {
  return base.tasks.find((task) => task.id === id)!;
}

test("a prepared legacy due edit replaces and clears the previously evaluated calendar day", () => {
  const old = day("2026-11-25");
  const base = {
    ...initial,
    tasks: [row("a", old, source("a", old, "2026-11-25T22:00:00+00:00"))],
  };
  const next = apply(base, { type: "setDue", ids: ["a"], due: "2026-12-03" });
  assert.equal(taskDueDay(item(next, "a"), zone), "2026-12-03");
  assert.equal(item(next, "a").due, "2026-12-03");
  assert.equal(item(next, "a").schedule?.due?.defaultTime, "08:30");
  assert.equal(
    effectiveDue(item(next, "a"))?.instant,
    "2026-12-03T13:30:00.000Z",
  );
  const cleared = apply(next, { type: "setDue", ids: ["a"], due: null });
  assert.equal(taskDueDay(item(cleared, "a"), zone), null);
  assert.equal(item(cleared, "a").due, null);
  assert.equal("due" in item(cleared, "a").schedule!, false);
  assert.equal(taskDueDay(item(base, "a"), zone), "2026-11-25");
});

test("schedule and bulk edits preserve the earliest ancestor source, including ties and a parent's personal default clock", () => {
  const clock: DateIntent = { kind: "instant", value: "2026-11-25T14:00:00Z" };
  const fixed = source("a", clock, "2026-11-25T14:00:00+00:00");
  const group = { ...row("g"), kind: "group" as const };
  const base = {
    ...initial,
    tasks: [
      group,
      row("a", clock, fixed, "g"),
      row("s", undefined, undefined, "g"),
    ],
  };
  const next = apply(base, {
    type: "set-schedule",
    ids: ["g"],
    changes: { schedule: { due: { kind: "date", value: "2026-11-25" } } },
  });
  assert.equal(effectiveDue(item(next, "a"))?.source, "g");
  assert.equal(taskDueDay(item(next, "s"), "Pacific/Honolulu"), "2026-11-25");
  const later = apply(next, {
    type: "bulk-inspect",
    ids: ["g"],
    changes: { schedule: { due: day("2026-12-03") } },
  });
  assert.equal(effectiveDue(item(later, "a"))?.source, "a");
  assert.strictEqual(effectiveDue(item(later, "a")), fixed);
  assert.equal(taskDueDay(item(later, "s"), zone), "2026-12-03");
  const tie = apply(later, {
    type: "bulk-inspect",
    ids: ["g"],
    changes: { schedule: { due: clock } },
  });
  assert.equal(effectiveDue(item(tie, "a"))?.source, "a");
  const cleared = apply(tie, {
    type: "bulk-inspect",
    ids: ["g", "a"],
    changes: { schedule: { due: null }, title: "Cleared" },
  });
  assert.equal(taskDueDay(item(cleared, "a"), zone), null);
  assert.equal(taskDueDay(item(cleared, "s"), zone), null);
  assert.equal(item(cleared, "a").title, "Cleared");
});

test("moving and capturing a subtree follows its new source and preserves the server's original resolved instant", () => {
  const west: DateIntent = {
    kind: "zoned",
    value: "2026-11-24T23:30:00.000001",
    zone: "America/Los_Angeles",
  };
  const trusted = source("g", west, "2026-11-25T07:30:00.000001+00:00");
  const own = day("2026-12-03");
  const base = {
    ...initial,
    tasks: [
      { ...row("g", west, trusted), kind: "group" as const },
      { ...row("sub"), kind: "group" as const },
      row("a", own, source("a", own, "2026-12-03T22:00:00+00:00"), "sub"),
    ],
  };
  const moved = apply(base, { type: "move", ids: ["sub"], parentId: "g" });
  assert.equal(taskDueDay(item(moved, "a"), zone), "2026-11-25");
  assert.strictEqual(effectiveDue(item(moved, "a")), trusted);
  const same = apply(moved, { type: "setDue", ids: ["g"], due: "2026-11-24" });
  assert.strictEqual(effectiveDue(item(same, "g")), trusted);
  assert.deepEqual(item(same, "g").schedule?.due, west);
  const captured = apply(same, {
    type: "capture",
    parentId: "sub",
    titles: ["New"],
  });
  const newItem = captured.tasks.find((task) => task.title === "New")!;
  assert.equal(taskDueDay(newItem, zone), "2026-11-25");
  assert.equal(newItem.effective, undefined);
  const movedBack = apply(captured, {
    type: "move",
    ids: ["sub"],
    parentId: "inbox",
  });
  assert.equal(taskDueDay(item(movedBack, "a"), zone), "2026-12-03");
  assert.equal(taskDueDay(item(movedBack, newItem.id), zone), null);
});

test("queued wall times honor DST gaps, both overlap folds and the snapshot view zone, while instants cross calendar days", () => {
  const base = { ...initial, tasks: [row("a")] };
  const change = (due: DateIntent) =>
    item(
      apply(base, {
        type: "set-schedule",
        ids: ["a"],
        changes: { schedule: { due } },
      }),
      "a",
    );
  for (const fold of [0, 1] as const) {
    const gap = change({
      kind: "zoned",
      value: "2026-03-08T02:30",
      zone,
      fold,
    });
    assert.equal(effectiveDue(gap)?.instant, "2026-03-08T07:30:00.000Z");
    const overlap = change({
      kind: "floating",
      value: "2026-11-01T01:30",
      fold,
    });
    assert.equal(
      effectiveDue(overlap)?.instant,
      `2026-11-01T0${5 + fold}:30:00.000Z`,
    );
  }
  const fixed = change({
    kind: "instant",
    value: "2026-12-03T00:30:00.123456+08:00",
  });
  assert.equal(fixed.due, "2026-12-02");
  assert.equal(taskDueDay(fixed, "Asia/Tokyo"), "2026-12-03");
  assert.equal(taskDueDay(fixed, zone), "2026-12-02");
  assert.equal(effectiveDue(fixed)?.instant, "2026-12-02T16:30:00.123456Z");
});

test("older saved projections replay the original envelope before offline display", () => {
  const old = day("2026-11-25");
  const base = {
    ...initial,
    tasks: [row("a", old, source("a", old, "2026-11-25T22:00:00Z"))],
  };
  const doc = freshData<QueueEntry>(base);
  const write = prepare(
    { type: "setDue", ids: ["a"], due: "2026-12-03" },
    base,
  );
  enqueue(doc, base, write);
  const entries = structuredClone(doc.queue);
  const stale = { ...base, localOperationIds: [write.envelope.operationId] };
  const restored = restoreProjection(base, stale, doc.queue);
  assert.equal(taskDueDay(item(restored, "a"), zone), "2026-12-03");
  assert.deepEqual(doc.queue, entries);
  assert.strictEqual(restoreProjection(base, restored, doc.queue), restored);
});

test("a folder date reaches projects and nested groups, and close instants keep their microsecond order", () => {
  const early: DateIntent = {
    kind: "instant",
    value: "2026-12-03T16:00:00.000001Z",
  };
  const late: DateIntent = {
    kind: "instant",
    value: "2026-12-03T16:00:00.000002Z",
  };
  const direct = source("task", late, late.value);
  const base: Snapshot = {
    ...initial,
    folders: [{ ...row("folder"), parentId: "root" }],
    projects: [{ ...row("project"), parentId: "folder" }],
    tasks: [
      { ...row("group", undefined, undefined, "project"), kind: "group" },
      row("task", late, direct, "group"),
    ],
  };
  const next = apply(base, {
    type: "set-schedule",
    ids: ["folder"],
    changes: { schedule: { due: early } },
  });
  assert.equal(effectiveDue(item(next, "task"))?.source, "folder");
  assert.equal(taskDueDay(item(next, "task"), zone), "2026-12-03");
  const cleared = apply(next, { type: "setDue", ids: ["folder"], due: null });
  assert.strictEqual(effectiveDue(item(cleared, "task")), direct);
  assert.throws(
    () =>
      apply(base, {
        type: "set-schedule",
        ids: ["task"],
        changes: {
          schedule: { due: { kind: "instant", value: "2026-12-03T12:00" } },
        },
      }),
    /timestamp/,
  );
  assert.throws(
    () =>
      apply(base, {
        type: "set-schedule",
        ids: ["task"],
        changes: {
          schedule: { due: { kind: "zoned", value: "2026-12-03T12:00" } },
        },
      }),
    /time zone/,
  );
});
