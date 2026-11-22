import { useMemo, useState } from "react";
import type { DragEvent, RefObject } from "react";
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
  const nav = useTreeNavigation(
    viewKey(view),
    ids,
    selection,
    props.select,
    props.tree,
  );
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dropBefore, setDropBefore] = useState<string>();
  const tagTitles = new Map(workspace.tags.map((tag) => [tag.id, tag.title]));
  const siblingSizes = new Map<string, number>();
  const positions = new Map<string, number>();
  const parentKey = (task: Task, depth: number) =>
    depth === 0 ? "" : task.parentId;
  for (const { task, depth } of rows) {
    const key = parentKey(task, depth);
    const position = (siblingSizes.get(key) ?? 0) + 1;
    positions.set(task.id, position);
    siblingSizes.set(key, position);
  }

  function endDrag() {
    setDragIds([]);
    setDropBefore(undefined);
  }

  function drop(event: DragEvent, parentId: string, beforeId?: string) {
    if (!dragIds.length) return;
    event.preventDefault();
    props.run({ type: "move", ids: dragIds, parentId, beforeId });
    endDrag();
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
        onFocus={(event) => {
          if (event.target === event.currentTarget) nav.revealActive();
        }}
        onScroll={nav.rememberScroll}
      >
        {rows.map(({ task, depth, hasChildren, context }) => {
          return (
            <TaskRow
              key={task.id}
              task={task}
              id={nav.rowId(task.id)}
              depth={depth}
              position={positions.get(task.id)!}
              size={siblingSizes.get(parentKey(task, depth))!}
              hasChildren={hasChildren}
              expanded={!props.collapsed.has(task.id)}
              active={nav.active === task.id}
              selected={selection.includes(task.id)}
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
                const moving = selection.includes(task.id)
                  ? selection
                  : [task.id];
                if (!selection.includes(task.id)) props.select(moving);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-focuspocus-outline",
                  "selection",
                );
                setDragIds(moving);
              }}
              dragOver={(event) => {
                if (
                  !dragIds.length ||
                  dragIds.includes(task.id) ||
                  !canReorder(view)
                )
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
        })}
      </div>
    </>
  );
}
