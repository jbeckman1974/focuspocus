import type { Task, Workspace } from "./types.ts";
import { newTask } from "./values.ts";

// The public board preview is disposable and uses dates in the current week.
export function createOffsiteSample(today: Date): Workspace {
  function day(offset: number) {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + offset,
      12,
    );
    return [
      String(date.getFullYear()).padStart(4, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }
  function task(
    id: string,
    title: string,
    fields: Partial<Pick<Task, "tags" | "due" | "inProgress" | "done">> = {},
  ): Task {
    return { ...newTask(id, "offsite", title), ...fields };
  }
  return {
    projects: [{ id: "offsite", title: "Team offsite" }],
    tags: [{ id: "logistics", title: "Logistics" }],
    tasks: [
      task("agenda", "Draft the agenda", { due: day(1) }),
      task("invitations", "Send invitations", { due: day(3) }),
      task("venue", "Book the venue", {
        inProgress: true,
        tags: ["logistics"],
        due: day(0),
      }),
      task("badges", "Order badges", { inProgress: true }),
      task("speakers", "Confirm speakers", { done: true }),
      task("recap", "Share the recap", { done: true }),
    ],
  };
}
