import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarTasks,
  dayInZone,
  formatDueDay,
  monthWeeks,
  shiftDay,
  shiftMonth,
  taskDueDay,
  weekDay,
} from "../src/components/presentations/calendarDates.ts";
import { newTask } from "../src/outline/values.ts";
import type { OutlineRow } from "../src/outline/types.ts";
import type { DateIntent } from "../src/persistent/schedule.ts";

const task = newTask("return", "inbox", "File return");
const newYork = "America/New_York";
const tokyo = "Asia/Tokyo";

function withEffectiveDue(value: DateIntent, instant: string) {
  return {
    ...task,
    due: "2027-01-10",
    effective: {
      status: "active" as const,
      flagged: false,
      blocked: false,
      reason: null,
      schedule: { due: { value, instant, source: "parent-project" } },
    },
  };
}

test("fixture dates and inherited date-only intent stay on their assigned day", () => {
  const leap = { ...task, due: "2028-02-29" };
  assert.equal(taskDueDay(leap, newYork), "2028-02-29");
  const inherited = withEffectiveDue(
    { kind: "date", value: "2026-12-31" },
    "2027-01-01T01:00:00Z",
  );
  assert.equal(taskDueDay(inherited, tokyo), "2026-12-31");
  assert.equal(taskDueDay({ ...task, due: "2026-02-29" }, newYork), null);
  const planned = {
    ...task,
    schedule: { planned: { kind: "date" as const, value: "2026-12-31" } },
  };
  assert.equal(taskDueDay(planned, newYork), null);
  assert.equal(
    formatDueDay("2028-02-29"),
    new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date("2028-02-29T12:00:00Z")),
  );
});

test("resolved zoned instants cross midnight and year boundaries in the workspace timezone", () => {
  const zoned = withEffectiveDue(
    { kind: "zoned", value: "2026-12-31T23:30", zone: "America/Los_Angeles" },
    "2027-01-01T07:30:00+00:00",
  );
  assert.equal(taskDueDay(zoned, newYork), "2027-01-01");
  assert.equal(taskDueDay(zoned, "America/Los_Angeles"), "2026-12-31");
  const pendingInstant = {
    ...task,
    schedule: {
      due: { kind: "instant" as const, value: "2026-03-08T04:30:00Z" },
    },
  };
  assert.equal(taskDueDay(pendingInstant, newYork), "2026-03-07");
  assert.equal(
    dayInZone(new Date("2026-03-08T04:30:00Z"), tokyo),
    "2026-03-08",
  );
});

test("civil-date navigation clamps month ends and crosses DST without skipping a day", () => {
  assert.equal(shiftMonth("2028-01-31", 1), "2028-02-29");
  assert.equal(shiftMonth("2027-03-31", -1), "2027-02-28");
  assert.equal(shiftMonth("2028-02-29", 12), "2029-02-28");
  assert.equal(shiftMonth("2026-12-23", 1), "2027-01-23");
  assert.equal(shiftDay("2026-03-08", -1), "2026-03-07");
  assert.equal(shiftDay("2026-11-01", 1), "2026-11-02");
  assert.equal(shiftDay("0001-01-01", -1), "0001-01-01");
});

test("the month grid starts on Sunday, includes adjacent days and ends after a full week", () => {
  const may = monthWeeks("2026-05-23");
  assert.equal(may.length, 6);
  assert.equal(may[0]?.[0], "2026-04-26");
  assert.equal(may.at(-1)?.[6], "2026-06-06");
  assert.ok(may.every((week) => week.length === 7 && weekDay(week[0]!) === 0));
  const february = monthWeeks("2026-02-12");
  assert.equal(february.length, 4);
  assert.equal(february.at(-1)?.[6], "2026-02-28");
  assert.equal(monthWeeks("0001-01-01")[0]![0], null);
  assert.equal(monthWeeks("9999-12-31").at(-1)![6], null);
});

test("the agenda retains task IDs and outline order and keeps undated tasks accessible", () => {
  const tasks = [
    { ...task, id: "context", due: "2026-11-23" },
    { ...task, id: "second-in-project", due: "2026-11-23" },
    { ...task, id: "undated" },
    { ...task, id: "next-in-outline", due: "2026-11-23", done: true },
  ];
  const rows: OutlineRow[] = tasks.map((entry, i) => ({
    task: entry,
    hasChildren: false,
    depth: i,
    context: i === 0,
  }));
  const calendar = calendarTasks(rows, newYork);
  assert.deepEqual(calendar.byDay.get("2026-11-23"), [tasks[1], tasks[3]]);
  assert.deepEqual(calendar.undated, [tasks[2]]);
  assert.equal(calendar.dayById.get("second-in-project"), "2026-11-23");
  assert.equal(calendar.dayById.has("context"), false);
});
