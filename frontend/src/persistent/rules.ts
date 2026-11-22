import type { Occurrence } from "./repeat.ts";
import type { Entry, OutlineRow, View } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";

import type { Schedule, EffectiveDate, DateField } from "./schedule.ts";

export type Mode = "parallel" | "sequential" | "single-action";
export type ItemStatus = "active" | "held" | "completed" | "dropped";
export type Availability = "everything" | "remaining" | "available" | "first-available" | "blocked";

export interface Properties {
  mode?: Mode | null;
  status?: ItemStatus;
  flagged?: boolean;
  autoComplete?: boolean;
}

export interface RuleFields extends Properties {
  repeat?: Occurrence | null;
  schedule?: Schedule;
  durationMinutes?: number | null;
  parentId?: string;
  effective?: {
    status: ItemStatus;
    schedule?: Partial<Record<DateField, EffectiveDate|null>>;
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

export function projectedRows(snapshot: Snapshot, result: OutlineResult, collapsed: ReadonlySet<string>): OutlineRow[] {
  const tasks = new Map(snapshot.tasks.map(task => [task.id, task]));
  const present = new Map(result.rows.filter(row => tasks.has(row.id)).map(row => [row.id, row]));
  const parents = new Set(Array.from(present.values(), row => row.parentId));
  const outline: OutlineRow[] = [];
  for (const row of present.values()) {
    const task = tasks.get(row.id)!;
    let depth = 0;
    let parent = present.get(row.parentId);
    while (parent && !collapsed.has(parent.id)) {
      depth++;
      parent = present.get(parent.parentId);
    }
    if (!parent) outline.push({ task, depth, hasChildren: parents.has(row.id), context: row.context });
  }
  return outline;
}

export function visibleSelection(rows: OutlineRow[], ids: string[]) {
  const included = new Set(rows.map(row => row.task.id));
  return ids.filter(id => included.has(id));
}
