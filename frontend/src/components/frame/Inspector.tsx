import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Command, Entry, Task, Workspace } from "../../outline/index.ts";
import { indexWorkspace } from "../../outline/index.ts";
import { TaskLocation } from "../TaskLocation.tsx";
import { Icon } from "./Icon.tsx";

interface InspectorProps {
  tools?: ReactNode;
  workspace: Workspace;
  selection: string[];
  run: (command: Command) => boolean | Promise<boolean>;
  onClose: () => void;
  pendingTag?: Extract<Command, { type: "setTag" }>;
  mutationsDisabled?: boolean;
}

type Drafts = Record<string, string>;

function SelectedTasks({
  items,
  locations,
}: {
  items: Task[];
  locations: ReadonlyMap<string, Entry>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="fp-selection-count fp-selection-list"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{items.length} items selected</summary>
      {open && (
        <ul aria-label="Selected tasks">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.title}</span>
              <TaskLocation location={locations.get(item.id)!} />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function TagOption({
  tag,
  items,
  pendingTag,
  onChange,
}: {
  tag: Entry;
  items: Task[];
  pendingTag?: InspectorProps["pendingTag"];
  onChange: (value: boolean) => void;
}) {
  const count = items.filter((item) =>
    pendingTag?.tagId === tag.id && pendingTag.ids.includes(item.id)
      ? pendingTag.enabled
      : item.tags.includes(tag.id),
  ).length;
  const mixed = count > 0 && count < items.length;
  return (
    <label className="fp-tag-option">
      <input
        type="checkbox"
        checked={count === items.length}
        ref={(element) => {
          if (element) element.indeterminate = mixed;
        }}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{tag.title}</span>
    </label>
  );
}

export function Inspector({
  tools,
  workspace,
  selection,
  run,
  onClose,
  pendingTag,
  mutationsDisabled = false,
}: InspectorProps) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const { byId, taskLocations } = indexWorkspace(workspace);
  const items = [...new Set(selection)].flatMap((id) => byId.get(id) ?? []);
  const ids = items.map((task) => task.id);
  const key = JSON.stringify([...ids].sort());
  const titleKey = `${key}:title`;
  const dateKey = `${key}:date`;
  const first = items[0];
  const mixedTitle = items.some((item) => item.title !== first?.title);
  const mixedDue = items.some((item) => item.due !== first?.due);
  const currentTitle = mixedTitle ? "" : (first?.title ?? "");
  const currentDate = mixedDue ? "" : (first?.due ?? "");
  const title = drafts[titleKey] ?? currentTitle;
  const date = drafts[dateKey] ?? currentDate;

  function writeDraft(field: string, value: string) {
    setDrafts((current) => ({ ...current, [field]: value }));
  }

  function discard(field: string, savedValue?: string) {
    setDrafts((current) => {
      if (savedValue !== undefined && current[field] !== savedValue)
        return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value || !first) return;
    const command: Command =
      ids.length > 1
        ? { type: "setTitle", ids, title: value }
        : { type: "rename", id: first.id, title: value };
    if (await run(command)) discard(titleKey, title);
  }

  async function saveDate(value: string) {
    if (await run({ type: "setDue", ids, due: value || null }))
      discard(dateKey, drafts[dateKey] ?? "");
  }

  return (
    <aside
      className="fp-inspector"
      aria-label="Task inspector"
      id="task-inspector"
      tabIndex={-1}
    >
      <div className="fp-panel-heading">
        <h2>
          <Icon name="inspector" size={21} /> Inspector
        </h2>
        <button
          type="button"
          aria-label="Close inspector"
          className="fp-icon-button"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {first ? (
        <div className="fp-inspector-body">
          {items.length === 1 ? (
            <div className="fp-selection-count fp-selection-info">
              <span>{first.kind === "group" ? "Action group" : "Action"}</span>
              <TaskLocation location={taskLocations.get(first.id)!} />
            </div>
          ) : (
            <SelectedTasks items={items} locations={taskLocations} />
          )}
          {tools}
          <form className="fp-edit-field" onSubmit={saveTitle}>
            <label htmlFor="inspector-title">Title</label>
            <input
              id="inspector-title"
              type="text"
              value={title}
              placeholder={mixedTitle ? "Mixed titles" : undefined}
              onChange={(event) =>
                writeDraft(titleKey, event.currentTarget.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") discard(titleKey);
              }}
            />
            <button
              type="submit"
              className="fp-secondary"
              disabled={
                mutationsDisabled ||
                !title.trim() ||
                (!mixedTitle && title.trim() === currentTitle)
              }
            >
              Apply title
            </button>
          </form>
          <form
            className="fp-edit-field"
            onSubmit={(event) => {
              event.preventDefault();
              saveDate(date);
            }}
          >
            <label htmlFor="inspector-date">Due date</label>
            {mixedDue && (
              <small id="mixed-date">
                The selection has different due dates.
              </small>
            )}
            <input
              id="inspector-date"
              type="date"
              value={date}
              aria-describedby={mixedDue ? "mixed-date" : undefined}
              onChange={(event) =>
                writeDraft(dateKey, event.currentTarget.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") discard(dateKey);
              }}
            />
            <div className="fp-field-actions">
              <button
                type="submit"
                className="fp-secondary"
                disabled={
                  mutationsDisabled ||
                  drafts[dateKey] === undefined ||
                  (!mixedDue && date === currentDate)
                }
              >
                Apply date
              </button>
              {(mixedDue || currentDate) && (
                <button
                  type="button"
                  className="fp-text-button"
                  disabled={mutationsDisabled}
                  onClick={() => saveDate("")}
                >
                  Clear date
                </button>
              )}
            </div>
          </form>
          <fieldset className="fp-tags-field" disabled={mutationsDisabled}>
            <legend>Tags</legend>
            {workspace.tags.map((tag) => (
              <TagOption
                key={tag.id}
                tag={tag}
                items={items}
                pendingTag={pendingTag}
                onChange={(enabled) =>
                  run({ type: "setTag", ids, tagId: tag.id, enabled })
                }
              />
            ))}
          </fieldset>
        </div>
      ) : (
        <div className="fp-inspector-empty">
          <Icon name="details" size={28} />
          <p>Select an action in the outline to edit its details.</p>
        </div>
      )}
    </aside>
  );
}
