import { useState } from "react";
import type { View } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";
import type { WorkspaceChannel, ChannelState } from "./channel.ts";
import { NewEntry } from "./NewEntry.tsx";
import { OrganizeDialog } from "./OrganizeDialog.tsx";

export function WorkspaceActions({
  snapshot,
  channel,
  state,
  view,
  selection,
  onSignOut,
  travel,
  deviceZone,
  setTravel,
}: {
  snapshot: Snapshot;
  channel: WorkspaceChannel;
  state: ChannelState;
  view: View;
  selection: string[];
  onSignOut: () => void;
  travel: boolean;
  deviceZone: string;
  setTravel: (value: boolean) => void;
}) {
  const [entry, setEntry] = useState<{
    kind: "tag" | "project";
    base: Snapshot;
    target?: { id: string; title: string };
  }>();
  const [organize, setOrganize] = useState<{
    view: View;
    selection: string[];
  }>();
  const disabled = state.phase !== "ready";
  return (
    <div className="private-actions">
      <button
        disabled={disabled}
        onClick={() => setEntry({ kind: "project", base: snapshot })}
      >
        New project
      </button>
      <button
        disabled={disabled}
        onClick={() => setEntry({ kind: "tag", base: snapshot })}
      >
        New tag
      </button>
      {view.kind === "project" && (
        <button
          disabled={disabled}
          onClick={() =>
            setEntry({
              kind: "project",
              base: snapshot,
              target: snapshot.projects.find((p) => p.id === view.id),
            })
          }
        >
          Rename project
        </button>
      )}
      <button
        disabled={disabled}
        onClick={() => setOrganize({ view, selection })}
      >
        Organize…
      </button>
      <button
        onClick={() => {
          if (
            !state.pending ||
            window.confirm("Leave this workspace with a pending change?")
          )
            onSignOut();
        }}
      >
        Sign out
      </button>
      {entry && (
        <NewEntry
          kind={entry.kind}
          initialTitle={entry.target?.title}
          onClose={() => setEntry(undefined)}
          onCreate={(title) =>
            channel.run(
              entry.target
                ? { type: "rename", id: entry.target.id, title }
                : {
                    type: entry.kind,
                    title,
                    ...(entry.kind === "project" && view.kind === "folder"
                      ? { parentId: view.id }
                      : {}),
                  },
              entry.base,
            )
          }
        />
      )}
      {organize && (
        <OrganizeDialog
          travel={travel}
          deviceZone={deviceZone}
          setTravel={setTravel}
          snapshot={snapshot}
          view={organize.view}
          selection={organize.selection}
          run={(intent, base) => channel.run(intent, base)}
          close={() => setOrganize(undefined)}
        />
      )}
    </div>
  );
}
