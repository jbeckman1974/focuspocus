import { INBOX } from "./types.ts";
import type { Task, Workspace } from "./types.ts";

/** One index for a workspace revision. Traversal never depends on the JS call stack. */
export class TaskTree {
  readonly byId = new Map<string, Task>();
  readonly roots: string[];
  private readonly childrenByParent = new Map<string, Task[]>();

  constructor(workspace: Workspace) {
    this.roots = [INBOX, ...workspace.projects.map((project) => project.id)];
    const used = new Set([INBOX]);
    for (const entry of [
      ...workspace.projects,
      ...workspace.tags,
      ...workspace.tasks,
    ]) {
      if (!entry.id.trim() || used.has(entry.id)) {
        throw new Error("Workspace item IDs must be present and unique.");
      }
      used.add(entry.id);
    }
    for (const task of workspace.tasks) {
      this.byId.set(task.id, task);
      const siblings = this.childrenByParent.get(task.parentId);
      if (siblings) siblings.push(task);
      else this.childrenByParent.set(task.parentId, [task]);
    }
    // Each task has one parent, so any unreachable task has an unknown parent or a cycle.
    let reachable = 0;
    for (const { task, hasChildren } of this.walk(this.roots)) {
      if (task.kind !== "group" && (task.kind !== "action" || hasChildren)) {
        throw new Error("Only groups may contain child tasks.");
      }
      reachable++;
    }
    if (reachable !== workspace.tasks.length) {
      throw new Error(
        "Every task must belong to the Inbox or a project without a cycle.",
      );
    }
  }

  children(parentId: string): readonly Task[] {
    return this.childrenByParent.get(parentId) ?? [];
  }

  task(id: string): Task {
    const task = this.byId.get(id);
    if (!task) throw new Error("The selected task no longer exists.");
    return task;
  }

  requireContainer(id: string) {
    if (!this.roots.includes(id) && this.byId.get(id)?.kind !== "group") {
      throw new Error(
        "Choose the Inbox, a project, or a group as the destination.",
      );
    }
  }

  *ancestors(task: Task): Generator<Task> {
    let parent = this.byId.get(task.parentId);
    while (parent) {
      yield parent;
      parent = this.byId.get(parent.parentId);
    }
  }

  *walk(roots: readonly string[], collapsed?: ReadonlySet<string>) {
    const stack: { task: Task; depth: number }[] = [];
    const pushChildren = (id: string, depth: number) => {
      const children = this.children(id);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ task: children[i]!, depth });
      }
    };
    for (let i = roots.length - 1; i >= 0; i--) pushChildren(roots[i]!, 0);
    while (stack.length) {
      const { task, depth } = stack.pop()!;
      const hasChildren = this.children(task.id).length > 0;
      yield { task, depth, hasChildren };
      if (hasChildren && !collapsed?.has(task.id))
        pushChildren(task.id, depth + 1);
    }
  }

  selection(ids: string[]): Task[] {
    if (!ids.length) throw new Error("Select at least one task.");
    const selected = new Set(ids);
    for (const id of selected) this.task(id);
    return Array.from(this.walk(this.roots), (row) => row.task).filter((task) =>
      selected.has(task.id),
    );
  }
}

// Fixture commands produce new workspace snapshots. Every row in a render shares this index.
const indexes = new WeakMap<Workspace, TaskTree>();

export function indexWorkspace(workspace: Workspace): TaskTree {
  let tree = indexes.get(workspace);
  if (!tree) {
    tree = new TaskTree(workspace);
    indexes.set(workspace, tree);
  }
  return tree;
}
