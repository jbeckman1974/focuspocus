import { useState } from "react";
import type { Snapshot } from "../api.ts";
import type { CatalogActions } from "./useCatalog.ts";
import type { SaveBody, Definition } from "./perspective.ts";
import { icons, groupNames, sortNames, toggleId } from "./perspective.ts";
import { RuleEditor } from "./RuleEditor.tsx";
import { PersonalNotice } from "./Focus.tsx";

export function PerspectiveEditor({
  initial,
  base,
  snapshot,
  catalog,
  close,
  saved,
}: {
  initial: SaveBody;
  base: number;
  snapshot: Snapshot;
  catalog: CatalogActions;
  close: () => void;
  saved: (id: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const applied = () => {
    saved(draft.id);
    close();
  };
  const change = (values: Partial<SaveBody>) =>
    setDraft((old) => ({ ...old, ...values }));
  const define = (values: Partial<Definition>) =>
    setDraft((old) => ({
      ...old,
      definition: { ...old.definition, ...values },
    }));
  return (
    <dialog
      aria-label="Edit perspective"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onCancel={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await catalog.save({ action: "save", payload: draft }, base)) {
            applied();
          }
        }}
      >
        <h2>Perspective</h2>
        <fieldset
          className="planning-editor-fields"
          aria-label="Perspective settings"
          disabled={!!catalog.pending}
        >
          <div className="planning-controls">
            <label>
              Perspective name{" "}
              <input
                required
                autoFocus
                maxLength={255}
                value={draft.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              Icon{" "}
              <select
                aria-label="Perspective icon"
                value={draft.icon}
                onChange={(e) => change({ icon: e.target.value })}
              >
                {icons.map((icon) => (
                  <option key={icon}>{icon}</option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.favorite}
                onChange={(e) => change({ favorite: e.target.checked })}
              />{" "}
              Favorite
            </label>
          </div>
          <RuleEditor
            node={draft.definition.expression}
            change={(expression) => define({ expression })}
            snapshot={snapshot}
          />
          <details>
            <summary>Scope projects and folders</summary>
            {[...(snapshot.folders ?? []), ...snapshot.projects].map(
              (entry) => (
                <label className="planning-choice" key={entry.id}>
                  <input
                    type="checkbox"
                    checked={draft.definition.scopeIds.includes(entry.id)}
                    onChange={() =>
                      define({
                        scopeIds: toggleId(draft.definition.scopeIds, entry.id),
                      })
                    }
                  />{" "}
                  {entry.title}
                </label>
              ),
            )}
          </details>
          <div className="planning-controls">
            <label>
              Group by{" "}
              <select
                aria-label="Group by"
                value={draft.definition.groupBy}
                onChange={(e) => define({ groupBy: e.target.value })}
              >
                {Object.entries(groupNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort by{" "}
              <select
                aria-label="Sort by"
                value={draft.definition.sortBy}
                onChange={(e) => define({ sortBy: e.target.value })}
              >
                {Object.entries(sortNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Direction{" "}
              <select
                aria-label="Sort direction"
                value={draft.definition.direction}
                onChange={(e) =>
                  define({
                    direction: e.target.value as Definition["direction"],
                  })
                }
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <label>
              Presentation{" "}
              <select
                aria-label="Presentation"
                value={draft.definition.presentation}
                onChange={(e) =>
                  define({
                    presentation: e.target.value as Definition["presentation"],
                  })
                }
              >
                <option value="list">List</option>
                <option value="outline">Outline</option>
              </select>
            </label>
          </div>
        </fieldset>
        {catalog.pending && (
          <PersonalNotice catalog={catalog} onApplied={applied} />
        )}
        <div className="planning-actions">
          <button type="submit" disabled={!!catalog.pending}>
            Save perspective
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
