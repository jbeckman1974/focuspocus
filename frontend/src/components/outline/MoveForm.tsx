import { useId, useState } from "react";
import type { Command, Workspace } from "../../outline/index.ts";
import { INBOX } from "../../outline/index.ts";
import { moveDestinations } from "./controls.ts";

interface Props {
  workspace: Workspace;
  selection: string[];
  submit: (command: Command) => void;
}

export function MoveForm({ workspace, selection, submit }: Props) {
  const destinationLabel = useId();
  const positionLabel = useId();
  const targets = moveDestinations(workspace, selection);
  const firstParent = workspace.tasks.find((task) =>
    selection.includes(task.id),
  )?.parentId;
  const [parentId, setParentId] = useState(
    targets.some((target) => target.id === firstParent) ? firstParent! : INBOX,
  );
  const [beforeId, setBeforeId] = useState("");
  const siblings = workspace.tasks.filter(
    (task) => task.parentId === parentId && !selection.includes(task.id),
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit({
          type: "move",
          ids: selection,
          parentId,
          beforeId: beforeId || undefined,
        });
      }}
    >
      <label>
        <span id={destinationLabel}>Move to</span>
        <select
          aria-labelledby={destinationLabel}
          autoFocus
          value={parentId}
          onChange={(event) => {
            setParentId(event.currentTarget.value);
            setBeforeId("");
          }}
        >
          {targets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span id={positionLabel}>Position</span>
        <select
          aria-labelledby={positionLabel}
          value={beforeId}
          onChange={(event) => setBeforeId(event.currentTarget.value)}
        >
          <option value="">At the end</option>
          {siblings.map((task) => (
            <option key={task.id} value={task.id}>
              Before {task.title}
            </option>
          ))}
        </select>
      </label>
      <button
        className="outline-primary"
        type="submit"
        disabled={!selection.length}
      >
        Move tasks
      </button>
    </form>
  );
}
