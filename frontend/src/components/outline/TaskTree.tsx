import { useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, RefObject } from "react";
import { effectiveDone, INBOX } from "../../outline/index.ts";
import type {
  Command,
  OutlineRow,
  Task,
  View,
  Workspace,
} from "../../outline/index.ts";
import { canReorder } from "../../outline/views.ts";
import { viewKey } from "../../workspace/viewState.ts";
import { TaskRow } from "./TaskRow.tsx";
import type { EditDraft } from "./TaskRow.tsx";
import { useOutlineWindow } from "./useOutlineWindow.ts";
import { useTreeNavigation } from "./useTreeNavigation.ts";

import { useCompletionShortcut } from "../frame/shortcuts.ts";
import { handleTreeKey } from "./keyboard.ts";
import type { OutlinePanel } from "./keyboard.ts";

interface TreeProps {
  mutationsDisabled?: boolean;
  workspace: Workspace;
  view: View;
  rows: OutlineRow[];
  tree: RefObject<HTMLDivElement | null>;
  selection: string[];
  select: (ids: string[]) => void;
  multiple: boolean;
  collapsed: ReadonlySet<string>;
  toggle: (id: string) => void;
  run: (command: Command) => boolean | Promise<boolean>;
  edit: (task: Task) => void;
  draft?: EditDraft;
  changeDraft: (value: string) => void;
  saveDraft: () => void;
  cancelDraft: () => void;
  panel: (panel: OutlinePanel) => void;
  undo: () => void;
  redo: () => void;
}

export function TaskTree(props: TreeProps) {
  const shortcut = useCompletionShortcut();
  const { rows, selection, workspace, view } = props;
  const ids = useMemo(() => rows.map(({ task }) => task.id), [rows]);
  const identity = viewKey(view);
  const rowWindow = useOutlineWindow(identity, ids, props.tree);
  const nav = useTreeNavigation(
    identity,
    ids,
    selection,
    props.select,
    props.tree,
  );
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dropBefore, setDropBefore] = useState<string>();
  const [dragSource, setDragSource] = useState<string>();
  const selected = useMemo(() => new Set(selection), [selection]);
  const tagTitles = useMemo(
    () => new Map(workspace.tags.map((tag) => [tag.id, tag.title])),
    [workspace.tags],
  );
  const { positions, siblingSizes } = useMemo(() => {
    const siblingSizes = new Map<string, number>();
    const positions = rows.map(({ task, depth }) => {
      const key = depth === 0 ? "" : task.parentId;
      const position = (siblingSizes.get(key) ?? 0) + 1;
      siblingSizes.set(key, position);
      return position;
    });
    return { positions, siblingSizes };
  }, [rows]);
  const indices = rowWindow.layout?.mounted(
    rowWindow.viewport.top,
    rowWindow.viewport.height,
    [nav.active, props.draft?.id, dragSource],
  );
  const pointerFocus = useRef(false);
  function pressRow(event: MouseEvent<HTMLDivElement>) {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest("[data-task-id]")
    )
      return;
    // Native focus occurs before click. Jumping to the previous cursor here
    // can unmount the pressed row before it receives the selection gesture.
    pointerFocus.current = true;
    window.setTimeout(() => {
      pointerFocus.current = false;
    }, 0);
  }

  function endDrag() {
    setDragSource(undefined);
    setDragIds([]);
    setDropBefore(undefined);
  }

  function drop(event: DragEvent, parentId: string, beforeId?: string) {
    if (!dragIds.length) return;
    event.preventDefault();
    props.run({ type: "move", ids: dragIds, parentId, beforeId });
    endDrag();
  }

  function renderRow(index: number) {
    const { task, depth, hasChildren, context } = rows[index];
    return (
      <TaskRow
        key={task.id}
        observe={rowWindow.observe}
        top={rowWindow.layout?.offsets[index]}
        task={task}
        id={nav.rowId(task.id)}
        depth={depth}
        position={positions[index]}
        size={siblingSizes.get(depth === 0 ? "" : task.parentId)!}
        hasChildren={hasChildren}
        expanded={!props.collapsed.has(task.id)}
        active={nav.active === task.id}
        selected={selected.has(task.id)}
        tags={task.tags.map((id) => tagTitles.get(id) ?? id)}
        done={effectiveDone(workspace, task.id)}
        draft={props.draft}
        mutationsDisabled={props.mutationsDisabled}
        context={context}
        dropBefore={dropBefore === task.id}
        select={(event) =>
          nav.select(
            task.id,
            event.shiftKey,
            props.multiple || event.metaKey || event.ctrlKey,
          )
        }
        edit={() => props.edit(task)}
        changeDraft={props.changeDraft}
        save={props.saveDraft}
        cancel={props.cancelDraft}
        toggle={() => {
          props.toggle(task.id);
          props.tree.current?.focus({ preventScroll: true });
        }}
        check={() => {
          props.run({
            type: task.done ? "reopen" : "complete",
            ids: [task.id],
          });
          props.tree.current?.focus({ preventScroll: true });
        }}
        actions={() => props.panel("commands")}
        dragStart={(event) => {
          if (props.draft?.id === task.id) {
            event.preventDefault();
            return;
          }
          const moving = selected.has(task.id) ? selection : [task.id];
          if (!selected.has(task.id)) props.select(moving);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(
            "application/x-focuspocus-outline",
            "selection",
          );
          setDragSource(task.id);
          setDragIds(moving);
        }}
        dragOver={(event) => {
          if (!dragIds.length || dragIds.includes(task.id) || !canReorder(view))
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropBefore(task.id);
        }}
        drop={(event) => {
          if (canReorder(view) && !dragIds.includes(task.id))
            drop(event, task.parentId, task.id);
        }}
        dragEnd={endDrag}
      />
    );
  }

  return (
    <>
      {dragIds.length > 0 && (
        <div className="outline-drop-tray" aria-label="Move dragged tasks">
          <span>Drop into</span>
          {[{ id: INBOX, title: "Inbox" }, ...workspace.projects].map(
            (entry) => (
              <span
                key={entry.id}
                className="outline-drop-zone"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropBefore(undefined);
                }}
                onDrop={(event) => drop(event, entry.id)}
              >
                {entry.title}
              </span>
            ),
          )}
        </div>
      )}
      <div
        ref={props.tree}
        className="outline-tree"
        role="tree"
        aria-label="Task outline"
        aria-multiselectable="true"
        aria-activedescendant={nav.active ? nav.rowId(nav.active) : undefined}
        tabIndex={0}
        onKeyDown={(event) => handleTreeKey(event, props, nav, ids, shortcut)}
        onPointerDownCapture={pressRow}
        onMouseDownCapture={pressRow}
        onFocus={(event) => {
          if (event.target === event.currentTarget && !pointerFocus.current)
            nav.revealActive();
        }}
        onScroll={rowWindow.onScroll}
      >
        {rowWindow.layout && indices ? (
          <div
            className="outline-window"
            role="presentation"
            style={{ height: rowWindow.layout.offsets.at(-1) }}
          >
            {indices.map(renderRow)}
          </div>
        ) : (
          rows.map((_, index) => renderRow(index))
        )}
      </div>
    </>
  );
}
