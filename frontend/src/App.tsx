import { useEffect, useState, useSyncExternalStore } from "react";
import { Frame } from "./components/Frame.tsx";
import { Outline } from "./components/Outline.tsx";
import { WorkspaceSession } from "./workspace/session.ts";
import { inbox } from "./workspace/viewState.ts";

function compactLayout() {
  return window.matchMedia("(max-width: 850px)").matches;
}

export default function App() {
  const [{ session, generation }, setFixture] = useState(() => ({
    session: new WorkspaceSession(),
    generation: 0,
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [captureSignal, setCaptureSignal] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(() => !compactLayout());
  const [editMode, setEditMode] = useState<"inline" | "inspector">("inline");

  useEffect(() => {
    if (!state.notice) return;
    const timer = window.setTimeout(
      () => session.dismissNotice(state.notice),
      8000,
    );
    return () => window.clearTimeout(timer);
  }, [session, state.notice]);

  function quickCapture() {
    session.changeView(inbox);
    if (compactLayout()) setInspectorOpen(false);
    setCaptureSignal((value) => value + 1);
  }

  function inspect() {
    setInspectorOpen(true);
    window.requestAnimationFrame(() => {
      const field = document.getElementById("inspector-title");
      (field ?? document.getElementById("task-inspector"))?.focus();
    });
  }

  function reset() {
    if (
      !window.confirm(
        "Reset the sample workspace? This discards your session edits and drafts.",
      )
    ) {
      return;
    }
    setFixture({ session: new WorkspaceSession(), generation: generation + 1 });
    setCaptureSignal(0);
    setInspectorOpen(!compactLayout());
    setEditMode("inline");
  }

  return (
    <Frame
      key={generation}
      workspace={state.workspace}
      view={state.view}
      onView={session.changeView}
      selection={state.selection}
      onSelect={session.select}
      run={session.run}
      onCapture={quickCapture}
      onReset={reset}
      inspectorOpen={inspectorOpen}
      setInspectorOpen={setInspectorOpen}
      editMode={editMode}
      setEditMode={setEditMode}
      message={state.notice?.text ?? ""}
    >
      <Outline
        workspace={state.workspace}
        view={state.view}
        selection={state.selection}
        onSelect={session.select}
        run={session.run}
        collapsed={state.collapsed}
        onToggle={session.toggle}
        undo={session.undo}
        redo={session.redo}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        captureSignal={captureSignal}
        editMode={editMode}
        onInspect={inspect}
      />
    </Frame>
  );
}
