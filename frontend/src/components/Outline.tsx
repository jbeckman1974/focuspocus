import { canReorder } from "../outline/views.ts";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { INBOX, visibleRows } from "../outline/index.ts";
import type {
  Command,
  Task,
  View,
  Workspace,
  OutlineRow,
} from "../outline/index.ts";
import { viewKey } from "../workspace/viewState.ts";
import { Capture } from "./outline/Capture.tsx";
import { TaskTree } from "./outline/TaskTree.tsx";
import type { OutlinePanel } from "./outline/keyboard.ts";
import type { EditDraft } from "./outline/TaskRow.tsx";
import { ActionDialog } from "./outline/ActionDialog.tsx";
import { viewTitle } from "./outline/controls.ts";
import "./outline/outline.css";

interface OutlineProps {
  rows?: OutlineRow[];
  tools?: ReactNode;
  count?: number;
  workspace: Workspace;
  view: View;
  selection: string[];
  onSelect: (ids: string[]) => void;
  run: (command: Command) => boolean;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  captureSignal: number;
  editMode: "inline" | "inspector";
  onInspect: () => void;
}

export function Outline(props: OutlineProps) {
  const { workspace, view, selection } = props;
  const rows = useMemo(
    () => props.rows ?? visibleRows(workspace, view, props.collapsed),
    [workspace, view, props.collapsed, props.rows],
  );
  const tree = useRef<HTMLDivElement>(null);
  const identity = viewKey(view);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string | undefined>>(
    {},
  );
  const [panel, setPanel] = useState<OutlinePanel>();
  const [multiple, setMultiple] = useState(false);
  const editId = editing[identity];
  const draft: EditDraft | undefined =
    editId && Object.hasOwn(titles, editId)
      ? { id: editId, title: titles[editId]! }
      : undefined;
  const selectedTask = workspace.tasks.find((task) => task.id === selection[0]);
  const title = viewTitle(view, workspace);
  const count = props.count ?? rows.length;

  function focusTree() {
    tree.current?.focus({ preventScroll: true });
  }

  function closePanel() {
    setPanel(undefined);
    window.requestAnimationFrame(focusTree);
  }

  function edit(task: Task) {
    props.onSelect([task.id]);
    setPanel(undefined);
    if (props.editMode === "inspector") {
      props.onInspect();
      return;
    }
    setTitles((previous) =>
      Object.hasOwn(previous, task.id)
        ? previous
        : { ...previous, [task.id]: task.title },
    );
    setEditing((previous) => ({ ...previous, [identity]: task.id }));
  }

  function cancelEdit() {
    if (editId) {
      setTitles((previous) => {
        const next = { ...previous };
        delete next[editId];
        return next;
      });
    }
    setEditing((previous) => ({ ...previous, [identity]: undefined }));
    focusTree();
  }

  function saveEdit() {
    if (
      draft &&
      props.run({ type: "rename", id: draft.id, title: draft.title })
    )
      cancelEdit();
  }

  return (
    <section className="task-outline" aria-label={`${title} tasks`}>
      <header className="outline-heading">
        <div className="outline-heading-title">
          <h1>{title}</h1>
          <span className="outline-count">
            {count} {count === 1 ? "item" : "items"}
          </span>
        </div>
        <div className="outline-history" aria-label="Edit history">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (U in outline)"
            disabled={!props.canUndo}
            onClick={props.undo}
          >
            ↶
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (Shift+U in outline)"
            disabled={!props.canRedo}
            onClick={props.redo}
          >
            ↷
          </button>
        </div>
      </header>
      {props.tools}
      <Capture
        identity={identity}
        destination={view.kind === "project" ? title : "Inbox"}
        signal={props.captureSignal}
        submit={(titles) =>
          props.run({
            type: "capture",
            titles,
            parentId: view.kind === "project" ? view.id : INBOX,
          })
        }
      />
      <div className="outline-toolbar" role="group" aria-label="Task actions">
        <button
          type="button"
          aria-pressed={multiple}
          onClick={() => setMultiple(!multiple)}
        >
          Select multiple
        </button>
        <span className="outline-selection-count" aria-live="polite">
          {selection.length} selected
        </span>
        <div className="outline-toolbar-commands">
          <button
            type="button"
            disabled={selection.length !== 1 || !selectedTask}
            onClick={() => selectedTask && edit(selectedTask)}
          >
            Edit
          </button>
          <button
            type="button"
            disabled={!selection.length}
            onClick={() => setPanel("group")}
          >
            Group…
          </button>
          <button
            type="button"
            disabled={!selection.length}
            onClick={() => setPanel("move")}
          >
            Move…
          </button>
          <button
            type="button"
            className="outline-more"
            aria-label="Outline commands"
            title="Outline commands (?)"
            onClick={() => setPanel("commands")}
          >
            •••
          </button>
        </div>
      </div>
      {!rows.length && (
        <p className="outline-empty">
          {view.kind === "tag"
            ? "No tasks have this tag."
            : "This outline is empty."}
        </p>
      )}
      <TaskTree
        workspace={workspace}
        view={view}
        rows={rows}
        tree={tree}
        selection={selection}
        select={props.onSelect}
        multiple={multiple}
        collapsed={props.collapsed}
        toggle={props.onToggle}
        run={props.run}
        edit={edit}
        draft={draft}
        changeDraft={(value) => {
          if (editId)
            setTitles((previous) => ({ ...previous, [editId]: value }));
        }}
        saveDraft={saveEdit}
        cancelDraft={cancelEdit}
        panel={setPanel}
        undo={props.undo}
        redo={props.redo}
      />
      {panel && (
        <ActionDialog
          key={panel}
          panel={panel}
          manualOrder={canReorder(view)}
          workspace={workspace}
          selection={selection}
          run={props.run}
          open={setPanel}
          close={closePanel}
          edit={() => selectedTask && edit(selectedTask)}
          inspect={() => {
            setPanel(undefined);
            props.onInspect();
          }}
          undo={props.undo}
          redo={props.redo}
          canUndo={props.canUndo}
          canRedo={props.canRedo}
        />
      )}
    </section>
  );
}
