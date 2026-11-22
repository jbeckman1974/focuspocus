import { useState } from "react";
import type { Snapshot } from "./api.ts";
import type { LifecycleChange, TagStatus } from "./lifecycle.ts";

export function TagSettings({
  snapshot,
  tag,
  submit,
}: {
  snapshot: Snapshot;
  tag: Snapshot["tags"][number];
  submit: (change: LifecycleChange) => void;
}) {
  const [title, setTitle] = useState(tag.title);
  return (
    <fieldset>
      <legend>Tag settings</legend>
      <label>
        Tag name
        <input
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </label>
      <button
        disabled={!title.trim() || title.trim() === tag.title}
        onClick={() =>
          submit({
            name: "edit-tag",
            payload: { id: tag.id, title: title.trim() },
          })
        }
      >
        Rename tag
      </button>
      <label>
        Tag status
        <select
          value={tag.status ?? "active"}
          onChange={(event) =>
            submit({
              name: "edit-tag",
              payload: {
                id: tag.id,
                status: event.currentTarget.value as TagStatus,
              },
            })
          }
        >
          <option value="active">Active</option>
          <option value="held">On hold</option>
          <option value="dropped">Dropped</option>
        </select>
      </label>
      <label>
        Parent tag
        <select
          value={tag.parentId ?? ""}
          onChange={(event) =>
            submit({
              name: "edit-tag",
              payload: {
                id: tag.id,
                parentId: event.currentTarget.value || null,
              },
            })
          }
        >
          <option value="">No parent</option>
          {snapshot.tags
            .filter((t) => t.id !== tag.id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={tag.exclusive ?? false}
          onChange={(event) =>
            submit({
              name: "edit-tag",
              payload: { id: tag.id, exclusive: event.currentTarget.checked },
            })
          }
        />
        Mutually exclusive child tags
      </label>
    </fieldset>
  );
}
