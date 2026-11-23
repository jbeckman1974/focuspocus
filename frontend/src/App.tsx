import { useEffect, useState, useSyncExternalStore } from "react";
import { Frame } from "./components/Frame.tsx";
import { Outline } from "./components/Outline.tsx";
import { WorkspaceSession } from "./workspace/session.ts";
import { inbox } from "./workspace/viewState.ts";
import { useTaskLayout } from "./workspace/taskLayout.ts";
import { createOffsiteSample } from "./outline/offsiteSample.ts";

function compactLayout() {
  return window.matchMedia("(max-width: 850px)").matches;
}

function sampleSession() {
  if (new URLSearchParams(window.location.search).get("demo") !== "offsite")
    return new WorkspaceSession();
  const session = new WorkspaceSession(createOffsiteSample(new Date()));
  session.changeView({ kind: "project", id: "offsite" });
  session.select(["venue"]);
  return session;
}

export default function App() {
  const [{ session, generation }, setFixture] = useState(() => ({
    session: sampleSession(),
    generation: 0,
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [captureSignal, setCaptureSignal] = useState(0);
  const layout = useTaskLayout();
  const [inspectorChoice, setInspectorOpen] = useState<boolean | null>(null);
  const inspectorOpen =
    inspectorChoice ?? (layout === "list" && !compactLayout());
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
    if (layout === "list" || state.view.kind !== "project")
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
    setFixture({ session: sampleSession(), generation: generation + 1 });
    setCaptureSignal(0);
    setInspectorOpen(null);
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
        layout={layout}
        onCapture={quickCapture}
        onCaptureHandled={() => setCaptureSignal(0)}
        workspace={state.workspace}
        view={state.view}
        selection={state.selection}
        onSelect={(ids) => session.select(ids, layout !== "list")}
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
