import type { TaskTree } from "./tree.ts";
import type { Command, Task, Workspace } from "./types.ts";
import { idAllocator, newTask, titleText } from "./values.ts";

type StructuralCommand = Extract<Command, { type: "group" | "move" | "indent" | "outdent" }>;

function oneParent(tasks: Task[]): string {
  const parentId = tasks[0]!.parentId;
  if (tasks.some((task) => task.parentId !== parentId)) {
    throw new Error("Choose tasks at the same outline level under one parent.");
  }
  return parentId;
}

/** Move only the roots of selected subtrees. Their children keep their direct parent IDs. */
function selectedRoots(selected: Task[], tree: TaskTree): Task[] {
  const ids = new Set(selected.map((task) => task.id));
  return selected.filter((task) => {
    for (const parent of tree.ancestors(task)) if (ids.has(parent.id)) return false;
    return true;
  });
}

function move(
  workspace: Workspace,
  tree: TaskTree,
  roots: Task[],
  parentId: string,
  beforeId?: string,
  promote?: Task,
): Workspace {
  if (!promote) tree.requireContainer(parentId);
  const moving = new Set(roots.map((task) => task.id));
  const destination = tree.byId.get(parentId);
  if (destination) {
    for (const task of [destination, ...tree.ancestors(destination)]) {
      if (moving.has(task.id)) throw new Error("A group cannot move inside its own subtree.");
    }
  }
  if (beforeId !== undefined && (tree.byId.get(beforeId)?.parentId !== parentId || moving.has(beforeId))) {
    throw new Error("Choose an unselected insertion point in the destination.");
  }
  const order = tree.children(parentId).map((task) => task.id);
  const remaining = order.filter((id) => !moving.has(id));
  const slot = beforeId === undefined ? remaining.length : remaining.indexOf(beforeId);
  remaining.splice(slot, 0, ...moving);
  if (order.length === remaining.length && order.every((id, index) => id === remaining[index])) {
    return workspace;
  }

  const tasks = workspace.tasks.filter((task) => !moving.has(task.id)).map((task) =>
    task.id === promote?.id && task.kind === "action" ? { ...task, kind: "group" as const } : task,
  );
  const index = beforeId === undefined ? tasks.length : tasks.findIndex((task) => task.id === beforeId);
  tasks.splice(index, 0, ...roots.map((task) => task.parentId === parentId ? task : { ...task, parentId }));
  return { ...workspace, tasks };
}

export function changeStructure(
  workspace: Workspace,
  tree: TaskTree,
  selected: Task[],
  command: StructuralCommand,
  newId: () => string,
) {
  const roots = selectedRoots(selected, tree);
  const selection = selected.map((task) => task.id);
  if (command.type === "move") {
    return { workspace: move(workspace, tree, roots, command.parentId, command.beforeId), selection };
  }
  const parentId = oneParent(roots);
  const first = roots[0]!;
  const siblings = tree.children(parentId);
  switch (command.type) {
    case "group": {
      const title = titleText(command.title);
      const id = idAllocator(workspace, newId)();
      const group = { ...newTask(id, parentId, title), kind: "group" as const };
      const moving = new Set(roots.map((task) => task.id));
      const tasks = workspace.tasks.map((task) => moving.has(task.id) ? { ...task, parentId: id } : task);
      tasks.splice(workspace.tasks.indexOf(first), 0, group);
      return { workspace: { ...workspace, tasks }, selection: [id] };
    }
    case "indent": {
      const previous = siblings[siblings.indexOf(first) - 1];
      if (!previous) throw new Error("Indent requires a previous sibling.");
      return { workspace: move(workspace, tree, roots, previous.id, undefined, previous), selection };
    }
    case "outdent": {
      const parent = tree.byId.get(parentId);
      if (!parent) throw new Error("These tasks are already at the top of their outline.");
      const peers = tree.children(parent.parentId);
      const next = peers[peers.indexOf(parent) + 1];
      return { workspace: move(workspace, tree, roots, parent.parentId, next?.id), selection };
    }
  }
}
