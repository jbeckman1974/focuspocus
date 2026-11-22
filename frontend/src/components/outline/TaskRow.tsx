import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, DragEvent, MouseEvent } from "react";
import type { Task } from "../../outline/index.ts";

export interface EditDraft {
  id: string;
  title: string;
}

interface RowProps {
  task: Task;
  id: string;
  depth: number;
  position: number;
  size: number;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  active: boolean;
  done: boolean;
  tags: string[];
  draft?: EditDraft;
  context?: boolean;
  dropBefore: boolean;
  select: (event: MouseEvent) => void;
  edit: () => void;
  changeDraft: (value: string) => void;
  save: () => void;
  cancel: () => void;
  toggle: () => void;
  check: () => void;
  actions: () => void;
  dragStart: (event: DragEvent) => void;
  dragOver: (event: DragEvent) => void;
  drop: (event: DragEvent) => void;
  dragEnd: () => void;
}

export function TaskRow(props: RowProps) {
  const { task, draft } = props;
  const input = useRef<HTMLInputElement>(null);
  const editing = draft?.id === task.id;
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  return (
    <div
      id={props.id}
      role="treeitem"
      aria-label={task.title}
      aria-describedby={`${props.id}-details`}
      aria-selected={props.selected}
      aria-expanded={props.hasChildren ? props.expanded : undefined}
      aria-level={props.depth + 1}
      aria-posinset={props.position}
      aria-setsize={props.size}
      data-task-id={task.id}
      data-active={props.active}
      data-done={props.done}
      data-context={props.context || undefined}
      data-drop-before={props.dropBefore}
      className="outline-row"
      style={{ "--depth": props.depth } as CSSProperties}
      draggable={!editing}
      onDragStart={props.dragStart}
      onDragOver={props.dragOver}
      onDrop={props.drop}
      onDragEnd={props.dragEnd}
      onClick={(event) => {
        if (!editing) props.select(event);
      }}
      onDoubleClick={() => {
        if (!editing) props.edit();
      }}
      onContextMenu={(event) => {
        if (editing) return;
        event.preventDefault();
        if (!props.selected) props.select(event);
        props.actions();
      }}
    >
      <span id={`${props.id}-details`} className="outline-visually-hidden">
        {props.context && "Ancestor. "}
        {task.effective?.reason} {task.effective?.flagged && "Flagged."} {props.done ? "Completed." : "Active."} {props.tags.join(", ")}{" "}
        {task.due && `Due ${task.due}.`}
      </span>
      {props.hasChildren ? (
        <button
          type="button"
          className="outline-disclosure"
          aria-label={`${props.expanded ? "Collapse" : "Expand"} ${task.title}`}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            props.toggle();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {props.expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="outline-disclosure-space" />
      )}
      <button
        type="button"
        className="outline-check"
        aria-label={`${props.done ? "Reopen" : "Complete"} ${task.title}`}
        disabled={props.done && !task.done}
        title={props.done && !task.done ? "Completed by its group" : undefined}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          props.check();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span aria-hidden="true">{props.done ? "✓" : ""}</span>
      </button>
      {editing ? (
        <form
          className="outline-inline-edit"
          onSubmit={(event) => {
            event.preventDefault();
            props.save();
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              props.cancel();
            }
          }}
        >
          <input
            ref={input}
            aria-label="Task title"
            value={draft.title}
            onChange={(event) => props.changeDraft(event.currentTarget.value)}
          />
          <button
            type="submit"
            disabled={!draft.title.trim()}
            aria-label="Save title"
          >
            Save
          </button>
          <button type="button" onClick={props.cancel} aria-label="Cancel edit">
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span
            className={
              task.kind === "group"
                ? "outline-title group-title"
                : "outline-title"
            }
          >
            {task.title}
          </span>
          <span className="outline-fields">
            {task.effective?.flagged && <span aria-label="Flagged">⚑</span>}
            {task.effective?.blocked && <span className="outline-blocked" title={task.effective.reason ?? undefined}>Blocked</span>}
            {props.tags.length > 0 && (
              <span className="outline-tags">{props.tags.join(" · ")}</span>
            )}
            {task.due && <time dateTime={task.due}>{task.due}</time>}
          </span>
        </>
      )}
    </div>
  );
}
