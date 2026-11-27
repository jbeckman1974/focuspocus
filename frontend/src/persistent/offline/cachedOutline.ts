import type { View } from "../../outline/index.ts";
import type { Snapshot } from "../api.ts";
import type {
  Availability,
  OutlineResult,
  QueryRow,
  RuleFields,
} from "../rules.ts";

type CachedRow = QueryRow &
  RuleFields & {
    tags?: string[];
    changedAt?: string | null;
    completedAt?: string | null;
  };

function descendantsOfTag(snapshot: Snapshot, selected: string) {
  const children = new Map<string, string[]>();
  for (const tag of snapshot.tags) {
    if (!tag.parentId) continue;
    const siblings = children.get(tag.parentId) ?? [];
    if (!children.has(tag.parentId)) children.set(tag.parentId, siblings);
    siblings.push(tag.id);
  }
  const ids = new Set<string>();
  const stack = [selected];
  while (stack.length) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return ids;
}

function includesRow(
  view: View,
  row: CachedRow,
  root: string,
  scope: boolean,
  tags: Set<string> | null,
) {
  switch (view.kind) {
    case "inbox":
      return root === "inbox";
    case "projects":
    case "project":
    case "folder":
      return root === "root" && scope;
    case "tag":
      return row.tags?.some((id) => tags?.has(id));
    case "tags":
      return Boolean(row.tags?.length);
    case "flagged":
      return row.effective?.flagged ?? row.flagged;
    case "completed":
      return row.status === "completed";
    default:
      return true;
  }
}

/** Use the last server evaluation for availability and the local tree for pending edits. */
export function cachedOutline(
  snapshot: Snapshot,
  view: View,
  availability: Availability,
): OutlineResult {
  const children = new Map<string, CachedRow[]>();
  const byId = new Map<string, CachedRow>();
  function add(row: CachedRow) {
    byId.set(row.id, row);
    const siblings = children.get(row.parentId) ?? [];
    if (!children.has(row.parentId)) children.set(row.parentId, siblings);
    siblings.push(row);
  }
  const directories = [
    ...(snapshot.folders ?? []).map((row) => ({
      ...row,
      kind: "folder" as const,
    })),
    ...snapshot.projects.map((row) => ({ ...row, kind: "project" as const })),
  ].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const row of directories)
    add({ ...row, parentId: row.parentId ?? "root", context: false });
  for (const row of snapshot.tasks) add({ ...row, context: false });

  const tags = view.kind === "tag" ? descendantsOfTag(snapshot, view.id) : null;
  const focus = new Set(snapshot.focusScopeIds ?? []);
  const destination = view.kind === "project" ? view.id : "inbox";
  let captureOutsideFocus = focus.size > 0;
  const scoped =
    view.kind === "folder" || view.kind === "project" ? view.id : null;
  const key =
    availability === "first-available" ? "firstAvailable" : availability;
  const stack = [
    { id: "inbox", root: "inbox", scope: !scoped, focused: !focus.size },
    { id: "root", root: "root", scope: !scoped, focused: !focus.size },
  ];
  const order: CachedRow[] = [];
  const matches: CachedRow[] = [];
  const structural = ["inbox", "all", "folder", "project", "projects"].includes(
    view.kind,
  );
  while (stack.length) {
    const branch = stack.pop()!;
    const row = byId.get(branch.id);
    const scope = branch.scope || scoped === branch.id;
    const focused = branch.focused || focus.has(branch.id);
    if (branch.id === destination) captureOutsideFocus = !focused;
    if (row) {
      order.push(row);
      const eligible =
        key === "everything" ||
        ((!structural || row.kind === "action") && row.effective?.[key]);
      if (
        focused &&
        eligible &&
        includesRow(view, row, branch.root, scope, tags)
      )
        matches.push(row);
    }
    const descendants = children.get(branch.id) ?? [];
    for (let i = descendants.length - 1; i >= 0; i--) {
      stack.push({ id: descendants[i]!.id, root: branch.root, scope, focused });
    }
  }
  const flat = view.kind === "completed" || view.kind === "changed";
  if (flat) {
    const field = view.kind === "completed" ? "completedAt" : "changedAt";
    matches.sort((a, b) => (b[field] ?? "").localeCompare(a[field] ?? ""));
  }
  const matched = new Set(matches.map((r) => r.id));
  const shown = new Set(matched);
  if (!flat)
    for (const row of matches) {
      let parent = byId.get(row.parentId);
      while (parent && !shown.has(parent.id)) {
        shown.add(parent.id);
        parent = byId.get(parent.parentId);
      }
    }
  return {
    workspaceId: snapshot.workspaceId,
    revision: snapshot.revision,
    captureOutsideFocus,
    view: view.kind,
    count: matches.length,
    matchIds: matches.map((row) => row.id),
    rows: flat
      ? matches
      : order
          .filter((row) => shown.has(row.id))
          .map((row) => ({ ...row, context: !matched.has(row.id) })),
  };
}
