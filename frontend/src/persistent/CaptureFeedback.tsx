import type { Entry } from "../outline/index.ts";
import type { ChannelState } from "./channel.ts";
import { captureStatus } from "./captureStatus.ts";
import type { CatalogActions } from "./planning/useCatalog.ts";

export function CaptureFeedback({
  project,
  outsideFocus,
  state,
  submissionId,
  catalog,
}: {
  project?: Entry;
  outsideFocus: boolean;
  state: ChannelState;
  submissionId: string | null;
  catalog: CatalogActions;
}) {
  const message = captureStatus(
    state,
    submissionId,
    project?.id ?? "inbox",
    project?.title ?? "Inbox",
  );
  if (!outsideFocus && !message) return null;
  const canInclude =
    outsideFocus &&
    project &&
    catalog.data?.focusIds.length &&
    !catalog.data.focusIds.includes(project.id) &&
    !state.offline;
  return (
    <div className="capture-feedback">
      <span role="status">
        {message}
        {message && outsideFocus && " "}
        {outsideFocus &&
          (project
            ? "This project is outside your Focus. Its tasks are hidden."
            : "Inbox tasks are hidden by Focus.")}
      </span>
      {canInclude ? (
        <button
          type="button"
          disabled={!!catalog.pending}
          onClick={() =>
            void catalog.save({
              action: "include-focus",
              payload: { id: project.id },
            })
          }
        >
          Include project in Focus
        </button>
      ) : null}
    </div>
  );
}
