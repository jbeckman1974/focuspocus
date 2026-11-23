import type { Entry } from "../../outline/types.ts";
import type { Snapshot } from "../api.ts";
import type { ItemStatus, RuleFields } from "../rules.ts";

export type Item = Entry &
  RuleFields & {
    version: number;
    done?: boolean;
    kind?: string;
    tags?: string[];
    due?: string | null;
  };
export const allItems = (s: Snapshot): Item[] => [
  ...s.tasks,
  ...s.projects,
  ...(s.folders ?? []),
];
const resolved = (value?: ItemStatus) =>
  value === "completed" || value === "dropped";

export function editItems(
  snapshot: Snapshot,
  ids: string[],
  change: (row: Item) => Partial<Item>,
): Snapshot {
  const targets = new Set(ids);
  const seen = new Set<string>();
  function update<T extends Item>(rows: T[]): T[] {
    return rows.map((row) => {
      if (!targets.has(row.id)) return row;
      seen.add(row.id);
      return { ...row, ...change(row) };
    });
  }
  const result = {
    ...snapshot,
    tasks: update(snapshot.tasks),
    projects: update(snapshot.projects),
    folders: snapshot.folders && update(snapshot.folders),
  };
  if (seen.size !== targets.size)
    throw new Error("The selected item no longer exists.");
  return result;
}

export function changeStatus(
  snapshot: Snapshot,
  ids: string[],
  status: ItemStatus,
) {
  const selected = new Set(ids);
  const initial = allItems(snapshot);
  const byId = new Map(initial.map((row) => [row.id, row]));
  const direct = new Map<string, ItemStatus>();
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new Error("The selected item no longer exists.");
    if (status === "completed" && snapshot.folders?.some((f) => f.id === id))
      throw new Error("A folder cannot be completed.");
    let ancestor = row.parentId ? byId.get(row.parentId) : undefined;
    let inherited = false;
    while (ancestor) {
      if (
        resolved(status) &&
        (selected.has(ancestor.id) || resolved(ancestor.status))
      ) {
        inherited = true;
        break;
      }
      if (
        !resolved(status) &&
        resolved(ancestor.status) &&
        !selected.has(ancestor.id)
      )
        throw new Error("Reopen the resolved parent first.");
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
    if (!inherited) direct.set(id, status);
  }
  const children = new Map<string, Item[]>();
  for (const row of initial) {
    const parent = row.parentId ?? "root";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(row);
  }
  // A live recurring child can produce a server-created successor.
  if (resolved(status)) {
    const parents = new Set(
      [...direct.keys()].map((id) => byId.get(id)?.parentId),
    );
    for (const id of parents) {
      if (!id) continue;
      const parent = byId.get(id);
      if (!parent?.autoComplete || resolved(direct.get(id) ?? parent.status))
        continue;
      if (
        (children.get(id) ?? []).every(
          (child) =>
            !child.repeat?.active &&
            resolved(direct.get(child.id) ?? child.status),
        )
      ) {
        direct.set(id, "completed");
        parents.add(parent.parentId);
      }
    }
  }
  const updated = new Map<string, Partial<Item>>();
  const stack = initial
    .filter((row) => !row.parentId || !byId.has(row.parentId))
    .map((row) => ({ row, inherited: undefined as ItemStatus | undefined }));
  while (stack.length) {
    const { row, inherited } = stack.pop()!;
    const next =
      direct.get(row.id) ?? row.status ?? (row.done ? "completed" : "active");
    const effective = resolved(next) ? next : (inherited ?? next);
    const patch: Partial<Item> = {};
    if (direct.has(row.id)) {
      patch.status = next;
      patch.done = next === "completed";
    }
    if (row.effective && effective !== row.effective.status) {
      const remaining = !resolved(effective);
      const wasResolved = resolved(row.effective.status);
      patch.effective = {
        ...row.effective,
        status: effective,
        remaining,
        available: remaining && !wasResolved && row.effective.available,
        firstAvailable:
          remaining && !wasResolved && row.effective.firstAvailable,
        blocked: remaining && !wasResolved && row.effective.blocked,
        reason: remaining
          ? wasResolved
            ? null
            : row.effective.reason
          : effective === "completed"
            ? "Completed"
            : "Dropped",
        reasonSource:
          remaining && wasResolved ? null : row.effective.reasonSource,
      };
    }
    if (Object.keys(patch).length) updated.set(row.id, patch);
    for (const child of children.get(row.id) ?? [])
      stack.push({ row: child, inherited: resolved(next) ? next : inherited });
  }
  return editItems(snapshot, [...updated.keys()], (row) =>
    updated.get(row.id)!,
  );
}
