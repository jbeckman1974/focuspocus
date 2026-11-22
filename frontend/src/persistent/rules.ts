import type { Occurrence } from "./repeat.ts";
import type { Entry, OutlineRow, View } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";

import type { Schedule, EffectiveDate, DateField } from "./schedule.ts";

export type Mode = "parallel" | "sequential" | "single-action";
export type ItemStatus = "active" | "held" | "completed" | "dropped";
export type Availability =
  "everything" | "remaining" | "available" | "first-available" | "blocked";

export interface Properties {
  mode?: Mode | null;
  status?: ItemStatus;
  flagged?: boolean;
  autoComplete?: boolean;
}

export interface RuleFields extends Properties {
  changedAt?: string | null;
  completedAt?: string | null;
  repeat?: Occurrence | null;
  schedule?: Schedule;
  durationMinutes?: number | null;
  parentId?: string;
  effective?: {
    status: ItemStatus;
    schedule?: Partial<Record<DateField, EffectiveDate | null>>;
    flagged: boolean;
    flagSource: string | null;
    remaining: boolean;
    available: boolean;
    firstAvailable: boolean;
    blocked: boolean;
    reason: string | null;
    reasonSource: string | null;
  };
}

export interface QueryRow extends Entry {
  parentId: string;
  kind: "action" | "group" | "project" | "folder";
  context: boolean;
}

export interface OutlineResult {
  workspaceId: string;
  revision: number;
  view?: string;
  rows: QueryRow[];
  count: number;
  matchIds: string[];
  nextDateBoundary?: string | null;
}

export function outlineQuery(view: View, availability: Availability) {
  const query = new URLSearchParams({ availability });
  if (view.kind === "folder") {
    query.set("view", "projects");
    query.set("folderId", view.id);
  } else if (view.kind === "project" || view.kind === "tag") {
    query.set("view", view.kind === "project" ? "projects" : "tags");
    query.set(view.kind === "project" ? "projectId" : "tagId", view.id);
  } else {
    query.set("view", view.kind);
  }
  return query.toString();
}

export function projectedRows(
  snapshot: Snapshot,
  result: OutlineResult,
  collapsed: ReadonlySet<string>,
): OutlineRow[] {
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const present = new Map(
    result.rows.filter((row) => tasks.has(row.id)).map((row) => [row.id, row]),
  );
  if (result.view === "changed" || result.view === "completed") {
    return Array.from(present.values(), (row) => ({
      task: tasks.get(row.id)!,
      depth: 0,
      hasChildren: false,
      context: false,
    }));
  }
  const parents = new Set(Array.from(present.values(), (row) => row.parentId));
  // Cache ancestor depths so deeply nested selections scale with the number of rows.
  const depths = new Map<string, number | null>();
  function depthOf(row: QueryRow) {
    const stack: QueryRow[] = [];
    let current: QueryRow | undefined = row;
    while (current && !depths.has(current.id)) {
      stack.push(current);
      current = present.get(current.parentId);
    }
    let depth: number | null = current ? (depths.get(current.id) ?? null) : -1;
    while (stack.length) {
      const node = stack.pop()!;
      depth =
        depth === null ||
        (present.has(node.parentId) && collapsed.has(node.parentId))
          ? null
          : depth + 1;
      depths.set(node.id, depth);
    }
    return depths.get(row.id) ?? null;
  }
  const outline: OutlineRow[] = [];
  for (const row of present.values()) {
    const depth = depthOf(row);
    if (depth !== null) {
      outline.push({
        task: tasks.get(row.id)!,
        depth,
        hasChildren: parents.has(row.id),
        context: row.context,
      });
    }
  }
  return outline;
}

const visibleByOutline = new WeakMap<OutlineRow[], Set<string>>();
export function visibleSelection(rows: OutlineRow[], ids: string[]) {
  if (!ids.length) return ids;
  let included = visibleByOutline.get(rows);
  if (!included) {
    included = new Set(rows.map((row) => row.task.id));
    visibleByOutline.set(rows, included);
  }
  return ids.filter((id) => included.has(id));
}
