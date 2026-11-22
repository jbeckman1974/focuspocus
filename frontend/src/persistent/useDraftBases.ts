import { useRef } from "react";
import type { FocusEvent, FormEvent, KeyboardEvent } from "react";
import type { Command } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";

// A background refresh may update a task while its field still contains the
// user's previous text. Keep the original precondition until submission or Esc.
export function useDraftBases(snapshot: Snapshot | null, selection: string[]) {
  const initial = useRef(new WeakMap<HTMLInputElement, Snapshot>());
  const drafts = useRef(new Map<string, Snapshot>());
  const key = (field: string, ids: string[]) => field + ":" + [...ids].sort().join(",");
  function fieldFor(input: HTMLInputElement) {
    if (input.id === "inspector-date") return key("due", selection);
    if (input.id === "inspector-title") return key("title", selection);
    if (input.getAttribute("aria-label") === "Task title") {
      const id = input.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
      if (id) return key("title", [id]);
    }
  }
  function onFocusCapture(event: FocusEvent) {
    const input = event.target;
    if (input instanceof HTMLInputElement && snapshot && fieldFor(input)) initial.current.set(input, snapshot);
  }
  function onInputCapture(event: FormEvent) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !snapshot) return;
    const field = fieldFor(input);
    if (field && !drafts.current.has(field)) drafts.current.set(field, initial.current.get(input) ?? snapshot);
  }
  function onKeyDownCapture(event: KeyboardEvent) {
    if (event.key !== "Escape" || !(event.target instanceof HTMLInputElement)) return;
    const field = fieldFor(event.target);
    if (field) drafts.current.delete(field);
  }
  function forCommand(command: Command) {
    const field = command.type === "rename" ? key("title", [command.id]) :
      command.type === "setTitle" ? key("title", command.ids) :
      command.type === "setDue" ? key("due", command.ids) : undefined;
    return {
      base: field ? drafts.current.get(field) ?? snapshot : snapshot,
      clear: () => { if (field) drafts.current.delete(field); },
    };
  }
  return { bindings: {onFocusCapture, onInputCapture, onKeyDownCapture}, forCommand };
}
