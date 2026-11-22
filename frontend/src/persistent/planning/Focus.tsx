import { useState } from "react";
import type { Snapshot } from "../api.ts";
import type { CatalogActions } from "./useCatalog.ts";
import { toggleId } from "./perspective.ts";

export function Focus({
  snapshot,
  catalog,
}: {
  snapshot: Snapshot;
  catalog: CatalogActions;
}) {
  const [draft, setDraft] = useState<{ ids: string[]; version: number }>();
  const entries = [...(snapshot.folders ?? []), ...snapshot.projects];
  const active = catalog.data?.focusIds ?? [];
  return (
    <div className="planning-focus">
      <button
        disabled={!catalog.data || !!catalog.pending}
        onClick={() =>
          setDraft({ ids: [...active], version: catalog.data!.personalVersion })
        }
      >
        Focus…
      </button>
      {!!active.length && (
        <>
          <span aria-label="Active focus">
            {entries
              .filter((entry) => active.includes(entry.id))
              .map((entry) => entry.title)
              .join(", ")}
          </span>
          <button
            disabled={!!catalog.pending}
            onClick={() =>
              void catalog.save({ action: "focus", payload: { ids: [] } })
            }
          >
            Clear focus
          </button>
        </>
      )}
      {draft && (
        <dialog
          aria-label="Focus"
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={() => setDraft(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await catalog.save(
                  { action: "focus", payload: { ids: draft.ids } },
                  draft.version,
                )
              )
                setDraft(undefined);
            }}
          >
            <h2>Focus</h2>
            <fieldset disabled={!!catalog.pending}>
              <legend>Projects and folders</legend>
              {entries.map((entry) => (
                <label key={entry.id} className="planning-choice">
                  <input
                    type="checkbox"
                    checked={draft.ids.includes(entry.id)}
                    onChange={() =>
                      setDraft({ ...draft, ids: toggleId(draft.ids, entry.id) })
                    }
                  />{" "}
                  {entry.title}
                </label>
              ))}
            </fieldset>
            {catalog.pending && <PersonalNotice catalog={catalog} onApplied={() => setDraft(undefined)} />}
            <div className="planning-actions">
              <button type="submit" disabled={!!catalog.pending}>
                Apply focus
              </button>
              <button type="button" onClick={() => setDraft(undefined)}>
                Cancel
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
export function PersonalNotice({ catalog, onApplied }: { catalog: CatalogActions; onApplied?: () => void }) {
  const entry = catalog.pending;
  if (!entry && !catalog.error) return null;
  async function retry() {
    if (await catalog.retry()) onApplied?.();
  }
  return (
    <p role={entry?.condition === "sending" ? "status" : "alert"}>
      {entry?.message ?? catalog.error}{" "}
      {entry?.condition === "retry" && (
        <button type="button" onClick={retry}>
          Retry same change
        </button>
      )}
      {entry?.condition === "conflict" && (
        <button type="button" onClick={retry}>
          Apply to latest version
        </button>
      )}
      {entry && entry.condition !== "sending" && (
        <button type="button" onClick={catalog.discard}>
          Dismiss change
        </button>
      )}
      {!entry && (
        <button type="button" onClick={catalog.read}>
          Retry perspectives
        </button>
      )}
    </p>
  );
}
