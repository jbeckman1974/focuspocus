import type { Task } from "../../outline/types.ts";

/** Keep the selected cards visible when changing presentations on a large outline. */
export function taskPage(
  tasks: readonly Task[],
  limit: number,
  selected: ReadonlySet<string>,
) {
  if (tasks.length <= limit) return tasks;
  const visible = tasks.slice(0, limit);
  if (selected.size) {
    for (let i = limit; i < tasks.length; i++) {
      const task = tasks[i]!;
      if (selected.has(task.id)) visible.push(task);
    }
  }
  return visible;
}
