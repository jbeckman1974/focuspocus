import { INBOX } from "../../outline/index.ts";
import type { Entry, Task, View, Workspace } from "../../outline/index.ts";

export function viewTitle(view: View, workspace: Workspace): string {
  switch (view.kind) {
    case "inbox":
      return "Inbox";
    case "all":
      return "Everything";
    case "project":
      return (
        workspace.projects.find((entry) => entry.id === view.id)?.title ??
        "Project"
      );
    case "tag":
      return (
        workspace.tags.find((entry) => entry.id === view.id)?.title ?? "Tag"
      );
  }
}

export interface TreeCursor {
  id: string;
  anchor: string;
  selection: string[];
}

export function stillSelected(
  cursor: TreeCursor | undefined,
  selection: string[],
): boolean {
  return (
    cursor !== undefined &&
    cursor.selection.length === selection.length &&
    cursor.selection.every((id, index) => id === selection[index])
  );
}

export function extendRange(
  ids: string[],
  cursor: TreeCursor | undefined,
  selection: string[],
  active: string | undefined,
  end: string,
): TreeCursor {
  // A command or history operation can replace the selection between navigation events.
  const oldAnchor =
    cursor && stillSelected(cursor, selection) ? cursor.anchor : undefined;
  const anchor =
    oldAnchor && ids.includes(oldAnchor) ? oldAnchor : (active ?? end);
  return { id: end, anchor, selection: selectThrough(ids, anchor, end) };
}

export function selectThrough(
  ids: string[],
  anchor: string,
  end: string,
): string[] {
  const startIndex = ids.indexOf(anchor);
  const endIndex = ids.indexOf(end);
  if (endIndex < 0) return [];
  if (startIndex < 0) return [end];
  return ids.slice(
    Math.min(startIndex, endIndex),
    Math.max(startIndex, endIndex) + 1,
  );
}

export function adjacentId(
  ids: string[],
  current: string,
  key: "ArrowUp" | "ArrowDown" | "Home" | "End",
): string | undefined {
  if (key === "Home") return ids[0];
  if (key === "End") return ids.at(-1);
  const index = ids.indexOf(current);
  if (index < 0) return ids[0];
  const delta = key === "ArrowUp" ? -1 : 1;
  return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
}

export function moveDestinations(
  workspace: Workspace,
  selection: string[],
): Entry[] {
  const roots = [{ id: INBOX, title: "Inbox" }, ...workspace.projects];
  const byId = new Map(workspace.tasks.map((task) => [task.id, task]));
  const rootNames = new Map(roots.map((root) => [root.id, root.title]));
  const selected = new Set(selection);
  const groups: Entry[] = [];
  for (const task of workspace.tasks) {
    if (task.kind !== "group") continue;
    const titles: string[] = [];
    const visited = new Set<string>();
    let node: Task | undefined = task;
    while (node && !selected.has(node.id) && !visited.has(node.id)) {
      visited.add(node.id);
      titles.unshift(node.title);
      const rootTitle = rootNames.get(node.parentId);
      if (rootTitle !== undefined) {
        groups.push({ id: task.id, title: [rootTitle, ...titles].join(" / ") });
        break;
      }
      node = byId.get(node.parentId);
    }
  }
  return [...roots, ...groups];
}
