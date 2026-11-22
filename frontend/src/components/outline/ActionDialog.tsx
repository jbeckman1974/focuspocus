import { useId, useLayoutEffect, useRef, useState } from "react";
import { effectiveDone } from "../../outline/index.ts";
import type { Command, Workspace } from "../../outline/index.ts";
import { MoveForm } from "./MoveForm.tsx";
import type { OutlinePanel } from "./keyboard.ts";

interface Props {
  panel: OutlinePanel;
  manualOrder: boolean;
  workspace: Workspace;
  selection: string[];
  run: (command: Command) => boolean;
  open: (panel: OutlinePanel) => void;
  close: () => void;
  edit: () => void;
  inspect: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function ActionDialog(props: Props) {
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const selected = props.selection;
  const complete = selected.length > 0 && selected.every((id) => effectiveDone(props.workspace, id));
  const title = { commands: "Outline commands", group: "Group tasks", move: "Move tasks" }[props.panel];

  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function submit(command: Command) {
    if (props.run(command)) {
      props.close();
    } else {
      setError("The selection could not be changed. Check its parent, order and destination.");
    }
  }

  const commands = [
    { name: "Edit title", key: "F2", enabled: selected.length === 1, invoke: props.edit },
    { name: "Inspect selection", key: "", enabled: !!selected.length, invoke: props.inspect },
    { name: "Group…", key: "G", enabled: !!selected.length, invoke: () => props.open("group") },
    { name: "Indent", key: "I", enabled: props.manualOrder && !!selected.length, invoke: () => submit({ type: "indent", ids: selected }) },
    { name: "Outdent", key: "O", enabled: props.manualOrder && !!selected.length, invoke: () => submit({ type: "outdent", ids: selected }) },
    { name: "Move…", key: "M", enabled: !!selected.length, invoke: () => props.open("move") },
    { name: complete ? "Reopen" : "Complete", key: "X", enabled: !!selected.length,
      invoke: () => submit({ type: complete ? "reopen" : "complete", ids: selected }) },
    { name: "Undo", key: "U", enabled: props.canUndo, invoke: () => { props.undo(); props.close(); } },
    { name: "Redo", key: "Shift+U", enabled: props.canRedo, invoke: () => { props.redo(); props.close(); } },
  ].filter((command) => command.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <dialog className="outline-dialog" ref={ref} aria-labelledby={heading}
      onCancel={(event) => { event.preventDefault(); props.close(); }}>
      <div className="outline-dialog-heading">
        <h2 id={heading}>{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={props.close}>×</button>
      </div>
      {props.panel === "commands" && (
        <>
          <input type="search" aria-label="Find a command" placeholder="Find a command…"
            value={search} autoFocus onChange={(event) => setSearch(event.currentTarget.value)} />
          <ul className="outline-command-list">
            {commands.map((command) => (
              <li key={command.name}><button type="button" disabled={!command.enabled}
                onClick={command.invoke} aria-label={command.name}>
                {command.name}{command.key && <kbd aria-hidden="true">{command.key}</kbd>}
              </button></li>
            ))}
          </ul>
          {!commands.length && <p>No matching commands.</p>}
          <p className="outline-key-help">In the outline, use ↑ and ↓ to move, Shift+arrows to select a range, and Space to toggle a row.</p>
        </>
      )}
      {props.panel === "group" && (
        <form onSubmit={(event) => {
          event.preventDefault();
          submit({ type: "group", ids: selected, title: name });
        }}>
          <label>Group title
            <input autoFocus value={name} placeholder="New group" required
              onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <button className="outline-primary" type="submit"
            disabled={!name.trim() || !selected.length}>Group tasks</button>
        </form>
      )}
      {props.panel === "move" && (
        <MoveForm workspace={props.workspace} selection={selected} submit={submit} />
      )}
      {error && <p role="alert" className="outline-dialog-error">{error}</p>}
    </dialog>
  );
}
