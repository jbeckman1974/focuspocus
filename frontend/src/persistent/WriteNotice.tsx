import { TaskLocation } from "../components/TaskLocation.tsx";
import { indexWorkspace } from "../outline/index.ts";
import type { ChannelState, WorkspaceChannel } from "./channel.ts";
import { describeDraft } from "./writes.ts";

function resolveFrom(button: HTMLButtonElement, resolve: () => void) {
  const main = button.closest("main");
  resolve();
  // Resolving removes the button. Keep the keyboard user in the current view.
  (main?.querySelector<HTMLElement>('[role="tree"]') ?? main)?.focus();
}

export function WriteNotice({
  state,
  channel,
}: {
  state: ChannelState;
  channel: WorkspaceChannel;
}) {
  if (
    !state.pending ||
    !state.snapshot ||
    !["conflict", "uncertain", "rejected", "retryable"].includes(state.phase)
  )
    return null;
  const intent = state.pending.intent;
  const { taskLocations } = indexWorkspace(state.snapshot);
  const ids = "ids" in intent ? intent.ids : "id" in intent ? [intent.id] : [];
  const current = state.snapshot.tasks.filter((t) => ids.includes(t.id));
  return (
    <section className="write-notice" aria-label="Pending change">
      <h2>
        {state.phase === "uncertain"
          ? "Unconfirmed change"
          : "Change needs attention"}
      </h2>
      <p role="alert">{state.message}</p>
      <p>Your change: {describeDraft(intent, state.snapshot)}</p>
      {state.phase === "conflict" &&
        state.conflictFresh &&
        current.map((task) => (
          <p key={task.id}>
            Current task: {task.title} · {task.done ? "Completed" : "Open"}
            {task.due ? " · Due " + task.due : ""}
            {task.tags.length > 0 &&
              " · " +
                state
                  .snapshot!.tags.filter((tag) => task.tags.includes(tag.id))
                  .map((tag) => tag.title)
                  .join(", ")}{" "}
            <TaskLocation location={taskLocations.get(task.id)!} />
          </p>
        ))}
      {state.phase === "conflict" &&
        state.conflictFresh &&
        state.snapshot.projects
          .filter((project) => ids.includes(project.id))
          .map((project) => (
            <p key={project.id}>Current project: {project.title}</p>
          ))}
      {(state.phase === "uncertain" || state.phase === "retryable") && (
        <button
          onClick={(event) =>
            resolveFrom(event.currentTarget, () => channel.retry())
          }
        >
          Retry original change
        </button>
      )}
      {state.phase !== "uncertain" && (
        <>
          {state.phase === "conflict" && (
            <button
              disabled={!state.conflictFresh}
              onClick={(event) =>
                resolveFrom(event.currentTarget, () => channel.reapply())
              }
            >
              Reapply my change
            </button>
          )}
          <button
            onClick={(event) =>
              resolveFrom(event.currentTarget, () => channel.discard())
            }
          >
            Discard my change
          </button>
        </>
      )}
    </section>
  );
}
