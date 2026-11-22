import { useEffect, useRef, useState } from "react";
import type { View } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";
import { FilingControls } from "./FilingControls.tsx";
import { TagSettings } from "./TagSettings.tsx";
import { SelectionActions } from "./SelectionActions.tsx";
import type { LifecycleChange } from "./lifecycle.ts";
import type { Intent } from "./writes.ts";
import { DateDefaultsForm } from "./DateDefaultsForm.tsx";
import { Shelf } from "./Shelf.tsx";
import type { ShelfPage } from "./Shelf.tsx";

export function OrganizeDialog({
  actorId,
  snapshot,
  view,
  selection,
  run,
  close,
  travel,
  deviceZone,
  setTravel,
  cleanUp,
}: {
  actorId: number;
  snapshot: Snapshot;
  view: View;
  selection: string[];
  run: (intent: Intent, base: Snapshot) => boolean;
  close: () => void;
  travel: boolean;
  deviceZone: string;
  setTravel: (value: boolean) => void;
  cleanUp: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<ShelfPage | "selection">("selection");
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const tag =
    view.kind === "tag"
      ? snapshot.tags.find((entry) => entry.id === view.id)
      : undefined;
  const containerId =
    view.kind === "project" || view.kind === "folder" ? view.id : null;
  const [base] = useState(snapshot);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function submit(change: LifecycleChange, revision = base.revision) {
    if (run({ type: "lifecycle", change }, { ...base, revision })) {
      if (change.name === "file-inbox") cleanUp();
      close();
    } else
      setMessage("Finish the pending change before organizing these items.");
  }
  return (
    <dialog
      className="fp-dialog organize-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="organize-heading"
    >
      <header>
        <h2 id="organize-heading">Organize workspace</h2>
        <button onClick={close}>Close</button>
      </header>
      <nav aria-label="Organization tools">
        {(
          [
            ["selection", "Selection"],
            ["trash", "Trash"],
            ["archive", "Archive"],
            ["preview", "Archive by date"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={page === value}
            onClick={() => setPage(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {message && <p role="alert">{message}</p>}
      {page !== "selection" ? (
        <Shelf
          key={page}
          actorId={actorId}
          page={page}
          snapshot={snapshot}
          submit={submit}
        />
      ) : (
        <>
          <SelectionActions
            snapshot={snapshot}
            selection={selection}
            containerId={containerId}
            submit={submit}
          />
          <fieldset>
            <legend>Folders</legend>
            <label>
              Folder name
              <input
                value={filename}
                onChange={(event) => setFilename(event.currentTarget.value)}
              />
            </label>
            <button
              disabled={!filename.trim()}
              onClick={() => {
                if (
                  run(
                    {
                      type: "folder",
                      title: filename.trim(),
                      parentId: view.kind === "folder" ? view.id : "root",
                    },
                    base,
                  )
                )
                  close();
              }}
            >
              Create folder
            </button>
          </fieldset>
          {tag && <TagSettings snapshot={snapshot} tag={tag} submit={submit} />}
          <label>
            Remove resolved rows
            <select
              value={snapshot.resolvedCleanup ?? "on-cleanup"}
              onChange={(event) =>
                submit({
                  name: "set-resolved-cleanup",
                  payload: {
                    mode:
                      event.currentTarget.value === "immediate"
                        ? "immediate"
                        : "on-cleanup",
                  },
                })
              }
            >
              <option value="immediate">Immediately</option>
              <option value="on-cleanup">
                On Clean Up or when leaving this view
              </option>
            </select>
          </label>
          {view.kind !== "inbox" && (
            <button
              onClick={() => {
                cleanUp();
                close();
              }}
            >
              Clean Up
            </button>
          )}
          <label>
            <input
              type="checkbox"
              checked={travel}
              onChange={(event) => setTravel(event.currentTarget.checked)}
            />
            View floating dates in device time zone ({deviceZone})
          </label>
          <DateDefaultsForm
            base={base}
            submit={(intent) => {
              if (run(intent, base)) close();
            }}
          />
          {view.kind === "inbox" && (
            <FilingControls
              snapshot={snapshot}
              selection={selection}
              submit={submit}
            />
          )}
        </>
      )}
    </dialog>
  );
}
