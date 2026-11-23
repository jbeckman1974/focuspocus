import type { Snapshot } from "../api.ts";
import {
  effectiveDue,
  type DateIntent,
  type EffectiveDate,
  type Schedule,
} from "../schedule.ts";
import { allItems, editItems, type Item } from "./queueItems.ts";
import { compareDueInstants, dueInstant } from "./dueInstant.ts";

const dateOnly = (value: string): DateIntent => ({ kind: "date", value });

function directDue(row: Item) {
  if (row.schedule && "due" in row.schedule) return row.schedule.due;
  return row.due ? dateOnly(row.due) : null;
}

function legacyDay(due: DateIntent) {
  return due.kind === "instant"
    ? new Date(due.value).toISOString().slice(0, 10)
    : due.value.slice(0, 10);
}

export function patchSchedule(row: Item, patch: Schedule, snapshot: Snapshot) {
  const schedule = { ...row.schedule };
  const prior = directDue(row);
  if (prior) schedule.due = prior;
  for (const field of ["defer", "planned", "due"] as const) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value) schedule[field] = value;
    else delete schedule[field];
  }
  if (!("due" in patch)) return { schedule };
  const due = schedule.due;
  if (due?.kind === "date" && !due.defaultTime)
    schedule.due = {
      ...due,
      defaultTime:
        snapshot.assignmentDueTime ?? snapshot.dateDefaults?.due ?? "17:00",
    };
  return { schedule, due: due ? legacyDay(due) : null };
}

// A legacy bulk-edit of the same direct day preserves the original time and zone.
export function patchDueDay(row: Item, day: string | null, snapshot: Snapshot) {
  const previous = directDue(row);
  if ((previous ? legacyDay(previous) : null) === day) return {};
  return patchSchedule(row, { due: day ? dateOnly(day) : null }, snapshot);
}

function sameIntent(a: DateIntent, b: DateIntent) {
  return (
    a.kind === b.kind &&
    a.value === b.value &&
    a.zone === b.zone &&
    (a.fold ?? 0) === (b.fold ?? 0) &&
    a.defaultTime === b.defaultTime
  );
}

export function projectDue(snapshot: Snapshot, ids: string[]) {
  const touched = new Set(ids);
  const items = allItems(snapshot);
  const known = new Set(items.map((row) => row.id));
  const children = new Map<string, Item[]>();
  const stack: { row: Item; inherited?: EffectiveDate; changed: boolean }[] =
    [];
  for (const row of items) {
    if (!row.parentId || !known.has(row.parentId)) {
      stack.push({ row, changed: false });
      continue;
    }
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row);
    children.set(row.parentId, siblings);
  }
  const updates = new Map<string, Partial<Item>>();
  const zone = snapshot.viewZone ?? snapshot.timeZone ?? "UTC";
  const defaultTime = snapshot.dateDefaults?.due ?? "17:00";
  while (stack.length) {
    const { row, inherited, changed } = stack.pop()!;
    const recalculate = changed || touched.has(row.id);
    const previous = effectiveDue(row);
    let due = previous;
    if (recalculate || (!previous && !row.effective)) {
      due = inherited;
      const direct = directDue(row);
      let masked: EffectiveDate | undefined;
      if (direct) {
        const knownDirect =
          previous?.source === row.id ? previous : row.maskedDirectDue;
        const candidate =
          knownDirect && sameIntent(direct, knownDirect.value)
            ? knownDirect
            : {
                value: direct,
                source: row.id,
                instant: dueInstant(direct, zone, defaultTime),
              };
        if (!due || compareDueInstants(candidate.instant, due.instant) <= 0)
          due = candidate;
        else masked = candidate;
      }
      if (recalculate && (due !== previous || masked !== row.maskedDirectDue)) {
        if (row.effective) {
          const schedule = { ...row.effective.schedule };
          if (due) schedule.due = due;
          else delete schedule.due;
          updates.set(row.id, {
            effective: { ...row.effective, schedule },
            maskedDirectDue: masked,
          });
        } else {
          updates.set(row.id, { projectedDue: due, maskedDirectDue: masked });
        }
      }
    }
    for (const child of children.get(row.id) ?? [])
      stack.push({ row: child, inherited: due, changed: recalculate });
  }
  return updates.size
    ? editItems(snapshot, [...updates.keys()], (row) => updates.get(row.id)!)
    : snapshot;
}
