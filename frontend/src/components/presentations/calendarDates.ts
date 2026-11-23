import type { OutlineRow, Task } from "../../outline/types.ts";
import { calendarDate } from "../../outline/values.ts";
import type { RuleFields } from "../../persistent/rules.ts";
import { effectiveDue } from "../../persistent/schedule.ts";

type CalendarTask = Task &
  Pick<RuleFields, "schedule" | "projectedDue"> & {
    effective?: NonNullable<Task["effective"]> &
      Pick<NonNullable<RuleFields["effective"]>, "schedule">;
  };

const zoneFormats = new Map<string | undefined, Intl.DateTimeFormat>();
const shortDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const fullDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeZone: "UTC",
});
const monthName = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// Calendar arithmetic uses UTC as a container for a civil date. It never converts
// a date-only due date through the viewer's midnight or a DST transition.
function civilDate(day: string) {
  return new Date(day + "T12:00:00Z");
}

function isoDay(date: Date) {
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  return date.toISOString().slice(0, 10);
}

function validDay(value: string | null) {
  try {
    return calendarDate(value);
  } catch {
    return null;
  }
}

export function dayInZone(instant: Date, timeZone?: string): string {
  const zone = timeZone || undefined;
  let format = zoneFormats.get(zone);
  if (!format) {
    const options = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    } as const;
    try {
      format = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
        ...options,
        timeZone: zone,
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      format = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
        ...options,
        timeZone: "UTC",
      });
    }
    zoneFormats.set(zone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return parts.year.padStart(4, "0") + "-" + parts.month + "-" + parts.day;
}

function instantDay(value: string, timeZone?: string) {
  const instant = new Date(value);
  return Number.isFinite(instant.valueOf())
    ? dayInZone(instant, timeZone)
    : null;
}

export function taskDueDay(
  task: CalendarTask,
  timeZone?: string,
): string | null {
  const due = effectiveDue(task);
  if (due) {
    return due.value.kind === "date"
      ? validDay(due.value.value)
      : instantDay(due.instant, timeZone);
  }
  const direct = task.schedule?.due;
  if (direct?.kind === "instant") return instantDay(direct.value, timeZone);
  if (direct?.kind === "date" || direct?.kind === "floating") {
    return validDay(direct.value.slice(0, 10));
  }
  // For a zoned wall time the server resolves gaps, overlaps and inheritance.
  // A local projection can show the wall date when it is already in the requested zone.
  if (
    direct?.kind === "zoned" &&
    direct.zone ===
      (timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  ) {
    return validDay(direct.value.slice(0, 10));
  }
  return validDay(task.due);
}

export function formatDueDay(day: string) {
  return shortDate.format(civilDate(day));
}

export function fullDayLabel(day: string) {
  return fullDate.format(civilDate(day));
}

export function monthLabel(day: string) {
  return monthName.format(civilDate(day));
}

export function shiftDay(day: string, offset: number) {
  const date = civilDate(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return isoDay(date) ?? day;
}

export function shiftMonth(day: string, offset: number) {
  const date = civilDate(day);
  const preferredDay = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + offset + 1, 0);
  date.setUTCDate(Math.min(preferredDay, date.getUTCDate()));
  return isoDay(date) ?? day;
}

export function weekDay(day: string) {
  return civilDate(day).getUTCDay();
}

export function monthWeeks(day: string): (string | null)[][] {
  const first = civilDate(day.slice(0, 7) + "-01");
  const weekday = first.getUTCDay();
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const count = Math.ceil((weekday + last.getUTCDate()) / 7);
  const date = new Date(first);
  date.setUTCDate(1 - weekday);
  return Array.from({ length: count }, () =>
    Array.from({ length: 7 }, () => {
      const key = isoDay(date);
      date.setUTCDate(date.getUTCDate() + 1);
      return key;
    }),
  );
}

export function calendarTasks(rows: readonly OutlineRow[], timeZone?: string) {
  const byDay = new Map<string, Task[]>();
  const dayById = new Map<string, string>();
  const undated: Task[] = [];
  for (const { task, context } of rows) {
    if (context) continue;
    const day = taskDueDay(task, timeZone);
    if (!day) {
      undated.push(task);
      continue;
    }
    let list = byDay.get(day);
    if (!list) {
      list = [];
      byDay.set(day, list);
    }
    list.push(task);
    dayById.set(task.id, day);
  }
  return { byDay, dayById, undated };
}
