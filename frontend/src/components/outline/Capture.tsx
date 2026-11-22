import { useLayoutEffect, useRef, useState } from "react";

interface CaptureProps {
  disabled?: boolean;
  identity: string;
  destination: string;
  signal: number;
  submit: (titles: string[]) => boolean;
}

export function Capture({
  identity,
  destination,
  disabled,
  signal,
  submit,
}: CaptureProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const input = useRef<HTMLTextAreaElement>(null);
  const lastSignal = useRef(signal);
  const draft = drafts[identity] ?? "";

  useLayoutEffect(() => {
    if (lastSignal.current !== signal) {
      input.current?.focus();
      lastSignal.current = signal;
    }
  }, [signal]);

  function update(value: string) {
    setDrafts((previous) => ({ ...previous, [identity]: value }));
  }

  function addTasks() {
    const titles = draft
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!disabled && titles.length && submit(titles)) {
      update("");
      input.current?.focus();
    }
  }

  return (
    <form
      className="outline-capture"
      aria-label="Capture tasks"
      onSubmit={(event) => {
        event.preventDefault();
        addTasks();
      }}
    >
      <span aria-hidden="true" className="outline-capture-mark">
        +
      </span>
      <textarea
        ref={input}
        aria-label="Task titles"
        title="Enter adds tasks. Shift+Enter starts another line."
        placeholder={`Add a task to ${destination}…`}
        rows={Math.min(4, draft.split(/\r\n|\n|\r/).length)}
        value={draft}
        onChange={(event) => update(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            addTasks();
          }
        }}
      />
      <button type="submit" disabled={disabled || !draft.trim()} aria-label="Add tasks">
        Add
      </button>
    </form>
  );
}
