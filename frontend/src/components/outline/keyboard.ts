import { effectiveDone } from "../../outline/index.ts";
import type {
  Command,
  OutlineRow,
  Task,
  View,
  Workspace,
} from "../../outline/index.ts";

export type OutlinePanel = "commands" | "group" | "move";

interface KeyActions {
  view: View;
  workspace: Workspace;
  selection: string[];
  rows: OutlineRow[];
  collapsed: ReadonlySet<string>;
  toggle: (id: string) => void;
  run: (command: Command) => boolean;
  edit: (task: Task) => void;
  panel: (panel: OutlinePanel) => void;
  undo: () => void;
  redo: () => void;
}

interface Navigation {
  active?: string;
  clearSelection: () => void;
  select: (id: string, extend?: boolean, toggle?: boolean) => void;
  navigate: (
    key: "ArrowUp" | "ArrowDown" | "Home" | "End",
    extend: boolean,
  ) => void;
}

interface TreeKeyEvent {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
  nativeEvent: { isComposing: boolean };
  preventDefault(): void;
}

export function handleTreeKey(
  event: TreeKeyEvent,
  actions: KeyActions,
  nav: Navigation,
  ids: string[],
) {
  if (
    event.target !== event.currentTarget ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.nativeEvent.isComposing
  ) {
    return;
  }

  const key = event.key;
  if (
    key === "ArrowDown" ||
    key === "ArrowUp" ||
    key === "Home" ||
    key === "End"
  ) {
    event.preventDefault();
    nav.navigate(key, event.shiftKey);
    return;
  }
  if (key === "?" || (key === "F10" && event.shiftKey)) {
    event.preventDefault();
    actions.panel("commands");
    return;
  }
  if (key.toLowerCase() === "u") {
    event.preventDefault();
    if (event.shiftKey) actions.redo();
    else actions.undo();
    return;
  }

  const { rows, selection, workspace } = actions;
  const row = rows.find(({ task }) => task.id === nav.active);
  if (!row) return;
  const { task, hasChildren } = row;
  switch (key.toLowerCase()) {
    case " ":
      nav.select(task.id, false, true);
      break;
    case "escape":
      nav.clearSelection();
      break;
    case "arrowleft":
      if (actions.view.kind === "tag") return;
      if (hasChildren && !actions.collapsed.has(task.id))
        actions.toggle(task.id);
      else if (ids.includes(task.parentId)) nav.select(task.parentId);
      break;
    case "arrowright":
      if (actions.view.kind === "tag" || !hasChildren) return;
      if (actions.collapsed.has(task.id)) actions.toggle(task.id);
      else {
        const child = rows.find((entry) => entry.task.parentId === task.id);
        if (child) nav.select(child.task.id);
      }
      break;
    case "enter":
    case "f2": {
      if (selection.length !== 1) return;
      const selected = rows.find((entry) => entry.task.id === selection[0]);
      if (!selected) return;
      actions.edit(selected.task);
      break;
    }
    case "g":
    case "m":
      if (!selection.length) return;
      actions.panel(key.toLowerCase() === "g" ? "group" : "move");
      break;
    case "i":
    case "o":
      if (!selection.length || actions.view.kind === "tag") return;
      actions.run({
        type: key.toLowerCase() === "i" ? "indent" : "outdent",
        ids: selection,
      });
      break;
    case "x":
      if (!selection.length) return;
      actions.run({
        type: selection.every((id) => effectiveDone(workspace, id))
          ? "reopen"
          : "complete",
        ids: selection,
      });
      break;
    default:
      return;
  }
  event.preventDefault();
}
