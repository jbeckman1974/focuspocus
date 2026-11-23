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
import { Icon } from "./frame/Icon.tsx";
import { LayoutSwitch } from "./presentations/LayoutSwitch.tsx";
import { TaskBoard } from "./presentations/TaskBoard.tsx";
import { TaskCalendar } from "./presentations/TaskCalendar.tsx";
import type { TaskLayout } from "../workspace/taskLayout.ts";
import "./presentations/layout.css";

const expandedRows = new Set<string>();

interface OutlineProps {
  mutationsDisabled?: boolean;
  rows?: OutlineRow[];
  tools?: ReactNode;
  notice?: ReactNode;
  layout: TaskLayout;
  timeZone?: string;
  onCapture: () => void;
  onCaptureHandled: () => void;
  count?: number;
  retainedCount?: number;
  workspace: Workspace;
  view: View;
  selection: string[];
  onSelect: (ids: string[]) => void;
  run: (command: Command) => boolean | Promise<boolean>;
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
  const { workspace, view, selection, layout } = props;
  const list = layout === "list";
  const collapsed = list ? props.collapsed : expandedRows;
  const rows = useMemo(
    () => props.rows ?? visibleRows(workspace, view, collapsed),
    [workspace, view, collapsed, props.rows],
  );
  const flatRows = useMemo(
    () => (list ? [] : rows.filter((row) => !row.context)),
    [list, rows],
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
  const activeDraft = useRef(draft);
  activeDraft.current = draft;
  const selectedTask = workspace.tasks.find((task) => task.id === selection[0]);
  const title = viewTitle(view, workspace);
  const count = props.count ?? rows.length;
  const destination = view.kind === "project" ? title : "Inbox";

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

  async function saveEdit() {
    if (
      draft &&
      (await props.run({ type: "rename", id: draft.id, title: draft.title }))
    ) {
      if (
        activeDraft.current?.id === draft.id &&
        activeDraft.current?.title === draft.title
      )
        cancelEdit();
    }
  }

  return (
    <section
      className="task-outline"
      data-layout={layout}
      aria-label={`${title} tasks`}
    >
      <header className="outline-heading">
        <div className="outline-heading-title">
          <Icon
            name={
              view.kind === "inbox"
                ? "inbox"
                : view.kind === "tag" || view.kind === "tags"
                  ? "tags"
                  : view.kind === "project" ||
                      view.kind === "projects" ||
                      view.kind === "folder"
                    ? "projects"
                    : "all"
            }
            size={26}
          />
          <h1>{title}</h1>
          <span className="outline-count">
            {count} {count === 1 ? "item" : "items"}
            {Boolean(props.retainedCount) &&
              ` · ${props.retainedCount} awaiting Clean Up`}
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
      <div className="presentation-bar">
        <LayoutSwitch layout={layout} />
        {!list && props.tools && (
          <details className="presentation-options">
            <summary>View options</summary>
            {props.tools}
          </details>
        )}
      </div>
      {props.notice}
      {list && props.tools}
      <Capture
        disabled={props.mutationsDisabled}
        collapsible={!list}
        identity={identity}
        destination={destination}
        signal={props.captureSignal}
        onFocusRequestHandled={props.onCaptureHandled}
        submit={(titles) =>
          props.run({
            type: "capture",
            titles,
            parentId: view.kind === "project" ? view.id : INBOX,
          })
        }
      />
      {list && (
        <>
          <div
            className="outline-toolbar"
            role="group"
            aria-label="Task actions"
          >
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
                disabled={props.mutationsDisabled || !selection.length}
                onClick={() => setPanel("group")}
              >
                Group…
              </button>
              <button
                type="button"
                disabled={props.mutationsDisabled || !selection.length}
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
            mutationsDisabled={props.mutationsDisabled}
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
        </>
      )}
      {layout === "board" && (
        <TaskBoard
          key={identity}
          rows={flatRows}
          workspace={workspace}
          selection={selection}
          onSelect={props.onSelect}
          onInspect={props.onInspect}
          run={props.run}
          disabled={props.mutationsDisabled}
          timeZone={props.timeZone}
          onCapture={props.onCapture}
          destination={destination}
        />
      )}
      {layout === "calendar" && (
        <TaskCalendar
          key={identity}
          workspace={workspace}
          rows={flatRows}
          selection={selection}
          timeZone={props.timeZone}
          onSelect={props.onSelect}
          onInspect={props.onInspect}
        />
      )}
      {panel && (
        <ActionDialog
          key={panel}
          panel={panel}
          mutationsDisabled={props.mutationsDisabled}
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
