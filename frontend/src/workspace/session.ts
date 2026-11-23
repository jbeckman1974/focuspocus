import { applyCommand, createSample } from "../outline/index.ts";
import type { Command, View, Workspace } from "../outline/index.ts";
import {
  containsSelection,
  homeView,
  inbox,
  reconcileSelection,
  revealSelection,
  viewExists,
  viewKey,
} from "./viewState.ts";
import type { ViewMemory } from "./viewState.ts";

interface Checkpoint {
  workspace: Workspace;
  view: View;
  selection: string[];
}

interface HistoryEntry {
  before: Checkpoint;
  after: Checkpoint;
  label: string;
}

export interface SessionSnapshot extends Checkpoint, ViewMemory {
  canUndo: boolean;
  canRedo: boolean;
  notice: { text: string } | null;
}

const historyLimit = 100;
const labels: Record<Command["type"], string> = {
  capture: "capture",
  rename: "title edit",
  setTitle: "title edit",
  setTag: "tag edit",
  setDue: "due date edit",
  setProgress: "progress change",
  group: "group",
  indent: "indent",
  outdent: "outdent",
  complete: "completion",
  reopen: "reopening",
  move: "move",
};

function checkpoint(snapshot: Checkpoint): Checkpoint {
  return {
    workspace: snapshot.workspace,
    view: snapshot.view,
    selection: snapshot.selection,
  };
}

/** The M1 fixture supports one local editor and an in-memory command history. */
export class WorkspaceSession {
  private snapshot: SessionSnapshot;
  private views = new Map<string, ViewMemory>();
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private makeId?: () => string;

  constructor(workspace = createSample(), makeId?: () => string) {
    this.makeId = makeId;
    const memory = reconcileSelection(workspace, inbox, new Set(), [], true);
    this.views.set(viewKey(inbox), memory);
    this.snapshot = {
      workspace,
      view: inbox,
      ...memory,
      canUndo: false,
      canRedo: false,
      notice: null,
    };
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: SessionSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  private show(
    workspace: Workspace,
    view: View,
    memory: ViewMemory,
    notice: SessionSnapshot["notice"] = null,
  ) {
    this.views.set(viewKey(view), memory);
    this.publish({
      workspace,
      view,
      ...memory,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      notice,
    });
  }

  changeView = (view: View) => {
    const { workspace, view: previous, selection } = this.snapshot;
    if (viewKey(previous) === viewKey(view) || !viewExists(workspace, view)) {
      return;
    }
    const memory = this.views.get(viewKey(view));
    this.show(
      workspace,
      view,
      reconcileSelection(
        workspace,
        view,
        memory?.collapsed ?? new Set(),
        memory?.selection ?? selection,
        !memory || memory.selection.length > 0,
      ),
    );
  };

  select = (ids: string[], reveal = false) => {
    const { workspace, view, collapsed } = this.snapshot;
    this.show(
      workspace,
      view,
      reveal
        ? revealSelection(workspace, view, collapsed, ids)
        : reconcileSelection(workspace, view, collapsed, ids),
    );
  };

  toggle = (id: string) => {
    const { workspace, view, selection, collapsed } = this.snapshot;
    if (
      !workspace.tasks.some((task) => task.id === id && task.kind === "group")
    ) {
      return;
    }
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    const memory = reconcileSelection(workspace, view, next, selection);
    if (memory.selection.length < selection.length) {
      // A collapsed ancestor takes the place of any hidden selected descendants.
      const retained = [...memory.selection, id];
      this.show(
        workspace,
        view,
        reconcileSelection(workspace, view, next, retained),
      );
      return;
    }
    this.show(workspace, view, memory);
  };

  run = (command: Command): boolean => {
    const before = this.snapshot;
    let result: ReturnType<typeof applyCommand>;
    try {
      result = applyCommand(before.workspace, command, this.makeId);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Edit could not be applied.";
      this.publish({ ...before, notice: { text } });
      return false;
    }
    const { workspace, selection } = result;
    if (workspace === before.workspace) {
      this.publish({ ...before, notice: { text: "No changes." } });
      return true;
    }
    let view = before.view;
    if (
      (command.type === "move" || command.type === "capture") &&
      selection[0] &&
      !containsSelection(workspace, view, selection)
    ) {
      view = homeView(workspace, selection[0]);
    }
    const collapsed =
      this.views.get(viewKey(view))?.collapsed ?? new Set<string>();
    const memory = revealSelection(workspace, view, collapsed, selection);
    this.past.push({
      before: checkpoint(before),
      after: { workspace, view, selection: memory.selection },
      label: labels[command.type],
    });
    if (this.past.length > historyLimit) this.past.shift();
    this.future.length = 0;
    const text =
      command.type === "capture"
        ? `Added ${selection.length} ${selection.length === 1 ? "task" : "tasks"}.`
        : `Applied ${labels[command.type]}.`;
    this.show(workspace, view, memory, { text });
    return true;
  };

  private restore(from: Checkpoint, to: Checkpoint, text: string) {
    const current = this.snapshot.view;
    const keepCurrent =
      viewKey(current) !== viewKey(from.view) &&
      containsSelection(to.workspace, current, to.selection);
    const view = keepCurrent ? current : to.view;
    const collapsed =
      this.views.get(viewKey(view))?.collapsed ?? new Set<string>();
    this.show(
      to.workspace,
      view,
      revealSelection(to.workspace, view, collapsed, to.selection),
      {
        text,
      },
    );
  }

  undo = () => {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push(entry);
    this.restore(entry.after, entry.before, `Undid ${entry.label}.`);
  };

  redo = () => {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push(entry);
    this.restore(entry.before, entry.after, `Redid ${entry.label}.`);
  };

  dismissNotice = (notice: SessionSnapshot["notice"]) => {
    if (notice && this.snapshot.notice === notice) {
      this.publish({ ...this.snapshot, notice: null });
    }
  };
}
