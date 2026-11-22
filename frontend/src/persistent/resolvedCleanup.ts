import type { OutlineRow } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";

export interface RowMemory {
  id: string;
  parentId: string;
  resolved: boolean;
  retained: boolean;
  depth: number;
  hasChildren: boolean;
  context?: boolean;
}

type CurrentTask = Snapshot["tasks"][number];

function isResolved(task: CurrentTask) {
  const status = task.effective?.status ?? task.status;
  return status === "completed" || status === "dropped" || task.done;
}

function collapsedAncestor(
  task: CurrentTask,
  tasks: Map<string, CurrentTask>,
  collapsed: ReadonlySet<string>,
) {
  let parent = task.parentId;
  const seen = new Set<string>();
  while (tasks.has(parent) && !seen.has(parent)) {
    if (collapsed.has(parent)) return true;
    seen.add(parent);
    parent = tasks.get(parent)!.parentId;
  }
  return false;
}

/** Retain only a visible row that just resolved in this view. A removed or
 * moved task always leaves this view, and current snapshot data supplies its text. */
export function resolvedRows(
  previous: RowMemory[],
  snapshot: Snapshot,
  base: OutlineRow[],
  collapsed: ReadonlySet<string>,
  immediate: boolean,
) {
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const present = new Map(base.map((row, index) => [row.task.id, index]));
  const held = new Map<number, OutlineRow[]>();
  let nextVisible = base.length;
  if (!immediate) {
    for (let i = previous.length - 1; i >= 0; i--) {
      const old = previous[i];
      const slot = present.get(old.id);
      if (slot !== undefined) {
        nextVisible = slot;
        continue;
      }
      const task = tasks.get(old.id);
      if (
        !task ||
        task.parentId !== old.parentId ||
        !isResolved(task) ||
        (old.resolved && !old.retained) ||
        collapsedAncestor(task, tasks, collapsed)
      )
        continue;
      const insert =
        nextVisible < base.length ? nextVisible : Math.min(i, base.length);
      const bucket = held.get(insert) ?? [];
      bucket.push({
        task,
        depth: old.depth,
        hasChildren: old.hasChildren,
        context: old.context,
      });
      held.set(insert, bucket);
    }
  }
  const rows: OutlineRow[] = [];
  for (let i = 0; i <= base.length; i++) {
    const bucket = held.get(i);
    if (bucket) rows.push(...bucket.reverse());
    if (i < base.length) rows.push(base[i]);
  }
  const memory = rows.map(
    ({ task, depth, hasChildren, context }): RowMemory => ({
      id: task.id,
      parentId: task.parentId,
      resolved: isResolved(tasks.get(task.id)!),
      retained: !present.has(task.id),
      depth,
      hasChildren,
      context,
    }),
  );
  return { rows, memory };
}
