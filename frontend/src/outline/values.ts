import { INBOX } from "./types.ts";
import type { Task, Workspace } from "./types.ts";

export function titleText(input: string): string {
  const title = input.trim();
  if (!title || /[\r\n]/.test(title)) {
    throw new Error("Enter a nonempty title on one line.");
  }
  return title;
}

export function calendarDate(input: string | null): string | null {
  if (input === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input) && !input.startsWith("0000")) {
    const date = new Date(input + "T00:00:00Z");
    if (Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === input) {
      return input;
    }
  }
  throw new Error("Enter a valid calendar date.");
}

export function idAllocator(workspace: Workspace, newId: () => string) {
  const used = new Set([
    INBOX,
    ...workspace.projects.map((entry) => entry.id),
    ...workspace.tags.map((entry) => entry.id),
    ...workspace.tasks.map((entry) => entry.id),
  ]);
  return () => {
    const id = newId();
    if (!id || id.trim() !== id || used.has(id)) throw new Error("The new task needs a unique ID.");
    used.add(id);
    return id;
  };
}

export function newTask(id: string, parentId: string, title: string): Task {
  return { id, parentId, title, kind: "action", tags: [], due: null, done: false };
}
