import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  effectiveDone,
  type Command,
  type OutlineRow,
  type Task,
  type Workspace,
} from "../../outline/index.ts";
import { Icon } from "../frame/Icon.tsx";
import { taskPage } from "./taskPage.ts";
import { formatDueDay, taskDueDay } from "./calendarDates.ts";
import "./board.css";

const laneNames = {
  next: "Next",
  progress: "In progress",
  done: "Done",
  held: "On hold",
  dropped: "Dropped",
} as const;
type Lane = keyof typeof laneNames;
const lanes = Object.keys(laneNames) as Lane[];

function taskLane(workspace: Workspace, task: Task): Lane {
  if (effectiveDone(workspace, task.id)) return "done";
  const status = task.effective?.status;
  if (status === "held" || status === "dropped") return status;
  return task.inProgress ? "progress" : "next";
}

interface BoardProps {
  rows: readonly OutlineRow[];
  workspace: Workspace;
  selection: readonly string[];
  onSelect: (ids: string[]) => void;
  onInspect: () => void;
  onCapture: () => void;
  run: (command: Command) => boolean | Promise<boolean>;
  disabled?: boolean;
  timeZone?: string;
  destination: string;
}

export function TaskBoard({
  rows,
  workspace,
  selection,
  onSelect,
  onInspect,
  onCapture,
  run,
  disabled,
  timeZone,
  destination,
}: BoardProps) {
  const board = useRef<HTMLElement>(null);
  const [limits, setLimits] = useState<Partial<Record<Lane, number>>>({});
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const focusAfterMove = useRef<{
    id: string;
    from: Lane;
    trigger: HTMLElement;
  } | null>(null);
  const buckets = useMemo(() => {
    const parts: Record<Lane, Task[]> = {
      next: [],
      progress: [],
      done: [],
      held: [],
      dropped: [],
    };
    for (const { task } of rows) parts[taskLane(workspace, task)].push(task);
    return parts;
  }, [rows, workspace]);
  const tagNames = useMemo(
    () => new Map(workspace.tags.map((tag) => [tag.id, tag.title])),
    [workspace.tags],
  );

  useLayoutEffect(() => {
    const pending = focusAfterMove.current;
    if (
      !pending ||
      buckets[pending.from].some((task) => task.id === pending.id)
    )
      return;
    focusAfterMove.current = null;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== pending.trigger
    )
      return;
    const title = board.current?.querySelector<HTMLButtonElement>(
      `[data-task-id="${CSS.escape(pending.id)}"] .board-card-title`,
    );
    (title ?? board.current)?.focus({ preventScroll: true });
  }, [buckets]);

  async function change(
    task: Task,
    lane: Lane,
    command: Command,
    trigger: HTMLElement,
  ) {
    const request = { id: task.id, from: lane, trigger };
    focusAfterMove.current = request;
    onSelect([task.id]);
    if (!(await run(command)) && focusAfterMove.current === request)
      focusAfterMove.current = null;
  }

  return (
    <section
      className="task-board"
      aria-label="Task board"
      tabIndex={-1}
      ref={board}
    >
      {lanes
        .filter(
          (lane) =>
            (lane !== "held" && lane !== "dropped") || buckets[lane].length > 0,
        )
        .map((lane) => {
          const limit = limits[lane] ?? 40;
          const cards = taskPage(buckets[lane], limit, selectedIds);
          return (
            <section
              className="board-lane"
              data-lane={lane}
              key={lane}
              aria-label={laneNames[lane]}
            >
              <header>
                <h2>{laneNames[lane]}</h2>
                <span className="board-count">{buckets[lane].length}</span>
              </header>
              <ul>
                {cards.map((task) => {
                  const selected = selectedIds.has(task.id);
                  const done = lane === "done";
                  const active = lane === "next" || lane === "progress";
                  const due = taskDueDay(task, timeZone);
                  return (
                    <li
                      className="board-card"
                      key={task.id}
                      data-task-id={task.id}
                      data-selected={selected}
                      data-done={done}
                    >
                      <div className="board-card-line">
                        <button
                          type="button"
                          className="board-check"
                          aria-label={
                            (done ? "Reopen " : "Complete ") + task.title
                          }
                          disabled={
                            disabled ||
                            (!active && !done) ||
                            (done && !task.done)
                          }
                          title={
                            done && !task.done
                              ? "Completed by its parent"
                              : undefined
                          }
                          onClick={(event) =>
                            void change(
                              task,
                              lane,
                              {
                                type: done ? "reopen" : "complete",
                                ids: [task.id],
                              },
                              event.currentTarget,
                            )
                          }
                        >
                          {done && <Icon name="complete" size={15} />}
                        </button>
                        <button
                          type="button"
                          className="board-card-title"
                          aria-pressed={selected}
                          onClick={() => onSelect([task.id])}
                        >
                          {task.title}
                        </button>
                      </div>
                      {(due ||
                        task.tags.length > 0 ||
                        task.effective?.blocked) && (
                        <div className="board-card-meta">
                          {due && (
                            <time dateTime={due} className="board-due">
                              <Icon name="calendar" size={14} />
                              {formatDueDay(due)}
                            </time>
                          )}
                          {task.tags.map(
                            (id) =>
                              tagNames.has(id) && (
                                <span key={id} className="board-tag">
                                  <Icon name="tags" size={13} />
                                  {tagNames.get(id)}
                                </span>
                              ),
                          )}
                          {task.effective?.blocked && (
                            <span
                              className="board-blocked"
                              title={task.effective.reason ?? undefined}
                            >
                              Blocked
                            </span>
                          )}
                        </div>
                      )}
                      {selected && (
                        <div className="board-card-actions">
                          {active && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={(event) =>
                                void change(
                                  task,
                                  lane,
                                  {
                                    type: "setProgress",
                                    ids: [task.id],
                                    inProgress: lane === "next",
                                  },
                                  event.currentTarget,
                                )
                              }
                            >
                              {lane === "next"
                                ? "Start task"
                                : "Return to Next"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onSelect([task.id]);
                              onInspect();
                            }}
                          >
                            Open details
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {cards.length < buckets[lane].length && (
                <button
                  type="button"
                  className="board-more"
                  onClick={() =>
                    setLimits((previous) => ({
                      ...previous,
                      [lane]: limit + 40,
                    }))
                  }
                >
                  Show more tasks
                </button>
              )}
              {lane === "next" && (
                <button
                  type="button"
                  className="board-add"
                  disabled={disabled}
                  aria-label={`Add task to ${destination}`}
                  onClick={onCapture}
                >
                  <Icon name="add" size={16} />
                  Add task
                </button>
              )}
              {lane === "progress" && !buckets.progress.length && (
                <p className="board-empty">
                  Select a task and choose Start task.
                </p>
              )}
              {lane === "done" && !buckets.done.length && (
                <p className="board-empty">Completed tasks appear here.</p>
              )}
            </section>
          );
        })}
    </section>
  );
}
