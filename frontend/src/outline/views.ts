import { indexWorkspace } from "./tree.ts";
import { INBOX } from "./types.ts";
import type { OutlineRow, View, Workspace } from "./types.ts";

export function visibleRows(
  workspace: Workspace,
  view: View,
  collapsed: ReadonlySet<string>,
): OutlineRow[] {
  const tree = indexWorkspace(workspace);
  switch (view.kind) {
    case "inbox":
      return [...tree.walk([INBOX], collapsed)];
    case "all":
      return [...tree.walk(tree.roots, collapsed)];
    case "project":
      if (!workspace.projects.some((project) => project.id === view.id))
        return [];
      return [...tree.walk([view.id], collapsed)];
    case "tag":
      if (!workspace.tags.some((tag) => tag.id === view.id)) return [];
      return [...tree.walk(tree.roots)]
        .filter(({ task }) => task.tags.includes(view.id))
        .map(({ task }) => ({ task, depth: 0, hasChildren: false }));
  }
}

export function effectiveDone(workspace: Workspace, id: string): boolean {
  const tree = indexWorkspace(workspace);
  const task = tree.task(id);
  if (task.done) return true;
  for (const parent of tree.ancestors(task)) if (parent.done) return true;
  return false;
}
