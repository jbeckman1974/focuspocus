import { INBOX, indexWorkspace, visibleRows } from "../outline/index.ts";
import type { View, Workspace } from "../outline/index.ts";

export interface ViewMemory {
  selection: string[];
  collapsed: ReadonlySet<string>;
}

export const inbox: View = { kind: "inbox" };
const expanded = new Set<string>();

export function viewKey(view: View): string {
  return "id" in view ? `${view.kind}:${view.id}` : view.kind;
}

export function viewExists(workspace: Workspace, view: View): boolean {
  switch (view.kind) {
    case "folder":
      return Boolean(
        workspace.folders?.some((folder) => folder.id === view.id),
      );
    case "project":
      return workspace.projects.some((project) => project.id === view.id);
    case "tag":
      return workspace.tags.some((tag) => tag.id === view.id);
    default:
      return true;
  }
}

export function containsSelection(
  workspace: Workspace,
  view: View,
  selection: string[],
): boolean {
  const ids = new Set(
    visibleRows(workspace, view, expanded).map(({ task }) => task.id),
  );
  return selection.length > 0 && selection.every((id) => ids.has(id));
}

/** Follow a task up its structural parents to the view that always contains it. */
export function homeView(workspace: Workspace, id: string): View {
  const tree = indexWorkspace(workspace);
  let top = tree.task(id);
  for (const parent of tree.ancestors(top)) top = parent;
  return top.parentId === INBOX ? inbox : { kind: "project", id: top.parentId };
}

export function reconcileSelection(
  workspace: Workspace,
  view: View,
  collapsed: ReadonlySet<string>,
  requested: string[],
  selectFirst = false,
): ViewMemory {
  const rows = visibleRows(workspace, view, collapsed);
  const visible = new Set(rows.map(({ task }) => task.id));
  const selection = [...new Set(requested)].filter((id) => visible.has(id));
  if (selectFirst && !selection.length && rows[0]) {
    selection.push(rows[0].task.id);
  }
  return { selection, collapsed };
}

export function expandSelectionAncestors(
  workspace: Workspace,
  collapsed: ReadonlySet<string>,
  requested: readonly string[],
): ReadonlySet<string> {
  if (!collapsed.size) return collapsed;
  let next: Set<string> | undefined;
  const tree = indexWorkspace(workspace);
  for (const id of requested) {
    const task = tree.byId.get(id);
    if (!task) continue;
    for (const parent of tree.ancestors(task)) {
      if (collapsed.has(parent.id)) {
        next ??= new Set(collapsed);
        next.delete(parent.id);
      }
    }
  }
  return next ?? collapsed;
}

export function revealSelection(
  workspace: Workspace,
  view: View,
  collapsed: ReadonlySet<string>,
  requested: string[],
): ViewMemory {
  return reconcileSelection(
    workspace,
    view,
    expandSelectionAncestors(workspace, collapsed, requested),
    requested,
  );
}
