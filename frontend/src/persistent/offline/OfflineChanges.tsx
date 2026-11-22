import { NoteConflictComparison } from "../content/NoteConflictComparison.tsx";
import type { ChannelState, WorkspaceChannel } from "../channel.ts";

export function OfflineChanges({
  state,
  channel,
  actorId,
}: {
  actorId: number;
  state: ChannelState;
  channel: WorkspaceChannel;
}) {
  if (!state.offline && !state.queue.length) return null;
  return (
    <section className="write-notice" aria-label="Offline changes">
      <h2>Offline changes</h2>
      <p role="status">
        {state.offline ? "Working offline. " : ""}
        {state.queue.length
          ? `${state.queue.length} pending on this device.`
          : "All saved changes are on this device."}
      </p>
      {state.offline && (
        <p>Availability and dates use the last server evaluation.</p>
      )}
      {state.queue.length > 0 && (
        <ol>
          {state.queue.map((change) => (
            <li key={change.id}>
              <strong>{change.description}</strong>
              {" · "}
              {
                {
                  queued: "Queued",
                  sent: "Awaiting acknowledgement",
                  conflict: "Needs review",
                  blocked: "Waiting for an earlier change",
                }[change.status]
              }
              {change.reason && <p>{change.reason}</p>}
              {(change.status === "conflict" ||
                change.status === "blocked") && (
                <>
                  {change.content?.action === "save" &&
                  state.snapshot &&
                  !state.reviewOnly ? (
                    <NoteConflictComparison
                      key={[
                        actorId,
                        state.snapshot.workspaceId,
                        state.snapshot.generation,
                        state.snapshot.offlineGrant?.id,
                        state.snapshot.revision,
                        change.id,
                        change.content.itemId,
                        state.offline,
                      ].join("/")}
                      actorId={actorId}
                      snapshot={state.snapshot}
                      change={change.content}
                      offline={state.offline}
                      canReapply={change.canReapply}
                      reapply={(reviewed) =>
                        void channel.resolveQueued(
                          change.id,
                          "reapply",
                          reviewed,
                        )
                      }
                    />
                  ) : (
                    <>
                      <dl>
                        <dt>Before the edit</dt>
                        <dd>{change.base}</dd>
                        <dt>Your draft</dt>
                        <dd>{change.draft}</dd>
                        <dt>On the server</dt>
                        <dd>{change.current}</dd>
                      </dl>
                      {!state.reviewOnly && change.canReapply && (
                        <button
                          disabled={state.offline}
                          onClick={() =>
                            void channel.resolveQueued(change.id, "reapply")
                          }
                        >
                          Reapply change
                        </button>
                      )}
                    </>
                  )}{" "}
                  <button
                    onClick={() =>
                      void channel.resolveQueued(change.id, "discard")
                    }
                  >
                    Discard change
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
