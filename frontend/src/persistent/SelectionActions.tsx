import { moveDestinations } from "../components/outline/controls.ts";
import { useState } from "react";
import type { Snapshot } from "./api.ts";
import type { LifecycleChange } from "./lifecycle.ts";

export function SelectionActions({
  snapshot,
  selection,
  containerId,
  submit,
}: {
  snapshot: Snapshot;
  selection: string[];
  containerId: string | null;
  submit: (change: LifecycleChange) => void;
}) {
  const [destination, setDestination] = useState("");
  const ids = selection.length ? selection : containerId ? [containerId] : [];
  const containers = selection.length
    ? moveDestinations(snapshot, selection)
    : [{ id: "root", title: "Project list" }, ...(snapshot.folders ?? [])];
  return !ids.length ? null : (
    <fieldset>
      <legend>
        {ids.length === 1 ? "Selected item" : `${ids.length} selected items`}
      </legend>
      <button onClick={() => submit({ name: "duplicate", payload: { ids } })}>
        Duplicate selection
      </button>
      <button onClick={() => submit({ name: "delete", payload: { ids } })}>
        Move to Trash
      </button>
      {selection.length > 0 &&
        selection.every((id) =>
          snapshot.tasks.some((t) => t.id === id && t.kind === "group"),
        ) && (
          <button onClick={() => submit({ name: "ungroup", payload: { ids } })}>
            Ungroup
          </button>
        )}
      <label>
        Destination
        <select
          value={destination}
          onChange={(event) => setDestination(event.currentTarget.value)}
        >
          <option value="">Choose destination</option>
          {containers
            .filter((item) => !ids.includes(item.id))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
        </select>
      </label>
      <button
        disabled={!destination}
        onClick={() =>
          submit({ name: "move", payload: { ids, parentId: destination } })
        }
      >
        Move selection
      </button>
    </fieldset>
  );
}
