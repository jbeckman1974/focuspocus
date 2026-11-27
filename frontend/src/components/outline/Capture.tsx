import { useId, useLayoutEffect, useRef, useState } from "react";

interface CaptureProps {
  disabled?: boolean;
  blockedReason?: string;
  collapsible?: boolean;
  identity: string;
  destination: string;
  signal: number;
  onFocusRequestHandled: () => void;
  submit: (titles: string[]) => boolean | Promise<boolean>;
}

export function Capture({
  identity,
  destination,
  disabled,
  blockedReason,
  collapsible = false,
  signal,
  onFocusRequestHandled,
  submit,
}: CaptureProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const input = useRef<HTMLTextAreaElement>(null);
  const statusId = useId();
  const lastSignal = useRef(0);
  const [openScope, setOpenScope] = useState<string>();
  const trigger = useRef<HTMLElement | null>(null);
  const focusRequested = useRef(false);
  const open = !collapsible || openScope === identity;
  const saving = useRef(false);
  const draft = drafts[identity] ?? "";

  useLayoutEffect(() => {
    if (signal && lastSignal.current !== signal) {
      lastSignal.current = signal;
      if (document.activeElement instanceof HTMLElement)
        trigger.current = document.activeElement;
      focusRequested.current = true;
      setOpenScope(identity);
    }
    if (!signal) lastSignal.current = 0;
    if (open && focusRequested.current && input.current) {
      focusRequested.current = false;
      input.current.focus();
      onFocusRequestHandled();
    }
  }, [signal, identity, open, onFocusRequestHandled]);

  function close() {
    setOpenScope(undefined);
    const target = trigger.current?.isConnected
      ? trigger.current
      : document.querySelector<HTMLElement>(
          '.task-layout-switch [aria-pressed="true"]',
        );
    target?.focus();
  }

  function update(value: string) {
    setDrafts((previous) => ({ ...previous, [identity]: value }));
  }

  async function addTasks() {
    const titles = draft
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (disabled || saving.current || !titles.length) return;
    saving.current = true;
    try {
      if (await submit(titles)) {
        setDrafts((previous) =>
          previous[identity] === draft
            ? { ...previous, [identity]: "" }
            : previous,
        );
        if (input.current?.form?.contains(document.activeElement))
          input.current.focus();
      }
    } finally {
      saving.current = false;
    }
  }

  if (!open) return null;
  return (
    <form
      className="outline-capture"
      aria-label="Capture tasks"
      onKeyDown={(event) => {
        if (collapsible && event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
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
        readOnly={disabled}
        aria-describedby={blockedReason ? statusId : undefined}
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
      <button
        type="submit"
        disabled={disabled || !draft.trim()}
        aria-label="Add tasks"
      >
        Add
      </button>
      {collapsible && (
        <button type="button" aria-label="Close capture" onClick={close}>
          Close
        </button>
      )}
      {blockedReason && (
        <span id={statusId} className="capture-blocked-reason">
          {blockedReason}
        </span>
      )}
    </form>
  );
}
