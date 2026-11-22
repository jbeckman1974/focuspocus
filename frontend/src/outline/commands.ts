import { changeStructure } from "./structure.ts";
import { indexWorkspace } from "./tree.ts";
import type { Command, CommandResult, Task, Workspace } from "./types.ts";
import { calendarDate, idAllocator, newTask, titleText } from "./values.ts";

function edit(workspace: Workspace, selected: Task[], change: (task: Task) => Task): CommandResult {
  const updates = new Map<string, Task>();
  for (const task of selected) {
    const update = change(task);
    if (update !== task) updates.set(task.id, update);
  }
  return {
    workspace: updates.size
      ? { ...workspace, tasks: workspace.tasks.map((task) => updates.get(task.id) ?? task) }
      : workspace,
    selection: selected.map((task) => task.id),
  };
}

/** The fixture transport commits the new immutable snapshot only after all validation succeeds. */
export function applyCommand(
  workspace: Workspace,
  command: Command,
  newId: () => string = () => crypto.randomUUID(),
): CommandResult {
  const tree = indexWorkspace(workspace);
  if (command.type === "capture") {
    tree.requireContainer(command.parentId);
    const titles = command.titles.flatMap((input) => input.split(/\r\n?|\n/))
      .map((line) => line.trim()).filter(Boolean);
    if (titles.length === 0) throw new Error("Enter at least one task to capture.");
    const allocate = idAllocator(workspace, newId);
    const tasks = titles.map((title) => newTask(allocate(), command.parentId, title));
    return {
      workspace: { ...workspace, tasks: [...workspace.tasks, ...tasks] },
      selection: tasks.map((task) => task.id),
    };
  }
  const selected = tree.selection(command.type === "rename" ? [command.id] : command.ids);
  switch (command.type) {
    case "rename":
    case "setTitle": {
      const title = titleText(command.title);
      return edit(workspace, selected, (task) => task.title === title ? task : { ...task, title });
    }
    case "setTag": {
      if (!workspace.tags.some((tag) => tag.id === command.tagId)) {
        throw new Error("Choose a tag in this workspace.");
      }
      return edit(workspace, selected, (task) => {
        if (task.tags.includes(command.tagId) === command.enabled) return task;
        const tags = command.enabled ? [...task.tags, command.tagId] : task.tags.filter((id) => id !== command.tagId);
        return { ...task, tags };
      });
    }
    case "setDue": {
      const due = calendarDate(command.due);
      return edit(workspace, selected, (task) => task.due === due ? task : { ...task, due });
    }
    case "complete":
    case "reopen": {
      const ids = new Set(selected.map((task) => task.id));
      const done = command.type === "complete";
      return edit(workspace, selected, (task) => {
        for (const parent of tree.ancestors(task)) {
          // Completing a group changes descendants' effective state, preserving their direct state.
          if (done && (ids.has(parent.id) || parent.done)) return task;
          if (!done && parent.done && !ids.has(parent.id)) {
            throw new Error("Reopen the completed parent group first.");
          }
        }
        return task.done === done ? task : { ...task, done };
      });
    }
    case "group":
    case "move":
    case "indent":
    case "outdent":
      return changeStructure(workspace, tree, selected, command, newId);
  }
}
