import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import type { OutlineRow, Task, Workspace } from "../../outline/types.ts";
import { effectiveDone } from "../../outline/views.ts";
import { indexWorkspace } from "../../outline/tree.ts";
import { Icon } from "../frame/Icon.tsx";
import { TaskLocation } from "../TaskLocation.tsx";
import { taskPage } from "./taskPage.ts";
import {
  calendarTasks,
  dayInZone,
  fullDayLabel,
  monthLabel,
  monthWeeks,
  shiftDay,
  shiftMonth,
  weekDay,
} from "./calendarDates.ts";
import "./calendar.css";

export interface TaskCalendarProps {
  workspace: Workspace;
  rows: readonly OutlineRow[];
  selection: readonly string[];
  onSelect: (ids: string[]) => void;
  onInspect: () => void;
  timeZone?: string;
}

const weekdayNames = Array.from({ length: 7 }, (_, weekday) => {
  const sunday = new Date(Date.UTC(2023, 0, 1 + weekday));
  const label = (format: "short" | "long") =>
    sunday.toLocaleDateString(undefined, { weekday: format, timeZone: "UTC" });
  return { short: label("short"), full: label("long") };
});

function progressLabel(workspace: Workspace, task: Task) {
  if (effectiveDone(workspace, task.id)) return "Completed";
  if (
    task.inProgress &&
    (!task.effective || task.effective.status === "active")
  )
    return "In progress";
  return undefined;
}

function TaskAgenda({
  workspace,
  tasks,
  selection,
  openTask,
}: {
  workspace: Workspace;
  tasks: readonly Task[];
  selection: ReadonlySet<string>;
  openTask: (task: Task) => void;
}) {
  const [limit, setLimit] = useState(20);
  const prefix = useId();
  const { taskLocations } = indexWorkspace(workspace);
  const visible = taskPage(tasks, limit, selection);
  return (
    <>
      <ul className="calendar-agenda-list">
        {visible.map((task) => {
          const status = progressLabel(workspace, task);
          const locationId = `${prefix}-location-${task.id}`;
          return (
            <li key={task.id}>
              <button
                type="button"
                className="calendar-agenda-task"
                data-task-id={task.id}
                data-done={status === "Completed"}
                data-in-progress={status === "In progress" || undefined}
                aria-label={status ? `${task.title} ${status}` : task.title}
                aria-describedby={locationId}
                aria-current={selection.has(task.id) || undefined}
                onClick={() => openTask(task)}
              >
                <span className="calendar-task-mark" aria-hidden="true">
                  {status === "Completed" && <Icon name="complete" size={13} />}
                </span>
                <span className="calendar-task-text">
                  <span>{task.title}</span>
                  <TaskLocation
                    location={taskLocations.get(task.id)!}
                    id={locationId}
                  />
                </span>
                {status && (
                  <span className="calendar-task-status">{status}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {visible.length < tasks.length && (
        <button
          type="button"
          className="calendar-show-more"
          onClick={() => setLimit(limit + 20)}
        >
          Show more tasks
        </button>
      )}
    </>
  );
}

export function TaskCalendar({
  workspace,
  rows,
  selection,
  onSelect,
  onInspect,
  timeZone,
}: TaskCalendarProps) {
  const tasks = useMemo(() => calendarTasks(rows, timeZone), [rows, timeZone]);
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const [clock, setClock] = useState(() => new Date());
  const today = dayInZone(clock, timeZone);
  const [chosenDay, setChosenDay] = useState<string>();
  const activeDay = chosenDay ?? tasks.dayById.get(selection[0] ?? "") ?? today;
  const month = activeDay.slice(0, 7);
  const weeks = useMemo(() => monthWeeks(month + "-01"), [month]);
  const dueTasks = tasks.byDay.get(activeDay) ?? [];
  const [undatedChoice, setUndatedChoice] = useState<{
    open: boolean;
    selection: ReadonlySet<string>;
  }>();
  const showUndated =
    undatedChoice?.open ||
    (!undatedChoice && tasks.byDay.size === 0) ||
    tasks.undated.some(
      ({ id }) => selectedIds.has(id) && !undatedChoice?.selection.has(id),
    );
  const undatedId = useId();
  const { taskLocations } = indexWorkspace(workspace);
  const activeButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    function checkDay() {
      const now = new Date();
      setClock((previous) =>
        dayInZone(previous, timeZone) === dayInZone(now, timeZone)
          ? previous
          : now,
      );
    }
    checkDay();
    const timer = window.setInterval(checkDay, 60_000);
    document.addEventListener("visibilitychange", checkDay);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkDay);
    };
  }, [timeZone]);

  useLayoutEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      activeButton.current?.focus();
    }
  }, [activeDay]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    let target: string;
    switch (event.key) {
      case "ArrowLeft":
        target = shiftDay(day, -1);
        break;
      case "ArrowRight":
        target = shiftDay(day, 1);
        break;
      case "ArrowUp":
        target = shiftDay(day, -7);
        break;
      case "ArrowDown":
        target = shiftDay(day, 7);
        break;
      case "Home":
        target = shiftDay(day, -weekDay(day));
        break;
      case "End":
        target = shiftDay(day, 6 - weekDay(day));
        break;
      case "PageUp":
        target = shiftMonth(day, event.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        target = shiftMonth(day, event.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target !== activeDay) {
      moveFocus.current = true;
      setChosenDay(target);
    }
  }

  function openTask(task: Task, day = activeDay) {
    setChosenDay(day);
    onSelect([task.id]);
    onInspect();
  }

  return (
    <section className="sorbet-calendar" aria-label="Task calendar">
      <div className="calendar-month">
        <header className="calendar-heading">
          <h2 aria-live="polite">{monthLabel(activeDay)}</h2>
          <div className="calendar-month-controls">
            <button
              type="button"
              className="calendar-month-step"
              aria-label="Previous month"
              disabled={month === "0001-01"}
              onClick={() => setChosenDay(shiftMonth(activeDay, -1))}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button type="button" onClick={() => setChosenDay(today)}>
              Today
            </button>
            <button
              type="button"
              className="calendar-month-step"
              aria-label="Next month"
              disabled={month === "9999-12"}
              onClick={() => setChosenDay(shiftMonth(activeDay, 1))}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </header>
        <table
          role="grid"
          className="calendar-grid"
          aria-label={`Due dates for ${monthLabel(activeDay)}`}
        >
          <thead>
            <tr>
              {weekdayNames.map((weekday) => (
                <th key={weekday.full} scope="col" abbr={weekday.full}>
                  {weekday.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.find(Boolean)}>
                {week.map((day, offset) => {
                  if (!day) return <td key={offset} />;
                  const entries = tasks.byDay.get(day) ?? [];
                  const preview = entries[0];
                  const location = preview && taskLocations.get(preview.id);
                  const locationId = `${undatedId}-preview-location-${day}`;
                  const previewStatus =
                    preview && progressLabel(workspace, preview);
                  const active = activeDay === day;
                  return (
                    <td
                      key={day}
                      aria-selected={active}
                      data-outside={day.slice(0, 7) !== month || undefined}
                    >
                      <button
                        type="button"
                        className="calendar-date"
                        ref={active ? activeButton : undefined}
                        tabIndex={active ? 0 : -1}
                        aria-current={day === today ? "date" : undefined}
                        aria-label={`${fullDayLabel(day)}, ${entries.length} ${entries.length === 1 ? "task" : "tasks"} due`}
                        onClick={() => setChosenDay(day)}
                        onKeyDown={(event) => navigate(event, day)}
                      >
                        <time dateTime={day}>{Number(day.slice(-2))}</time>
                        {entries.length > 0 && (
                          <span
                            className="calendar-mobile-count"
                            aria-hidden="true"
                          >
                            {entries.length}
                          </span>
                        )}
                      </button>
                      {preview && location && (
                        <div className="calendar-preview">
                          <button
                            type="button"
                            tabIndex={active ? 0 : -1}
                            data-task-id={preview.id}
                            data-done={previewStatus === "Completed"}
                            data-in-progress={
                              previewStatus === "In progress" || undefined
                            }
                            aria-label={`Open ${preview.title}`}
                            aria-describedby={locationId}
                            aria-current={
                              selectedIds.has(preview.id) || undefined
                            }
                            title={`${preview.title} · ${location.title}`}
                            onClick={() => openTask(preview, day)}
                          >
                            <span className="calendar-preview-title">
                              {preview.title}
                            </span>
                            <TaskLocation location={location} id={locationId} />
                          </button>
                          {entries.length > 1 && (
                            <span aria-hidden="true">
                              +{entries.length - 1}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="calendar-agenda">
        <section aria-label="Selected day agenda">
          <h3>
            <time dateTime={activeDay}>{fullDayLabel(activeDay)}</time>
          </h3>
          {dueTasks.length ? (
            <TaskAgenda
              key={activeDay}
              workspace={workspace}
              tasks={dueTasks}
              selection={selectedIds}
              openTask={openTask}
            />
          ) : (
            <p className="calendar-empty">No tasks due on this day.</p>
          )}
        </section>
        {tasks.undated.length > 0 && (
          <section className="calendar-undated">
            <h3>
              <button
                type="button"
                aria-expanded={showUndated}
                aria-controls={undatedId}
                onClick={() =>
                  setUndatedChoice({
                    open: !showUndated,
                    selection: selectedIds,
                  })
                }
              >
                <span>No due date</span>
                <span className="calendar-undated-count">
                  {tasks.undated.length}
                </span>
                <span aria-hidden="true" className="calendar-disclosure">
                  ⌄
                </span>
              </button>
            </h3>
            <div id={undatedId} hidden={!showUndated}>
              {showUndated && (
                <TaskAgenda
                  workspace={workspace}
                  tasks={tasks.undated}
                  selection={selectedIds}
                  openTask={openTask}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
