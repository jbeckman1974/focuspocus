import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Frame } from "../components/Frame.tsx";
import { Outline } from "../components/Outline.tsx";
import {
  homeView,
  inbox,
  viewExists,
  viewKey,
  containsSelection,
} from "../workspace/viewState.ts";
import type { View, Command } from "../outline/index.ts";
import { useDraftBases } from "./useDraftBases.ts";
import { workspaceApi } from "./api.ts";
import { WorkspaceChannel } from "./channel.ts";
import { WorkspaceActions } from "./WorkspaceActions.tsx";
import { hasEligibleFiling } from "./lifecycle.ts";
import { AvailabilityFilter, RuleControls } from "./RuleControls.tsx";
import { projectedRows, visibleSelection } from "./rules.ts";
import type { Availability, Properties, RuleFields } from "./rules.ts";
import type { Entry } from "../outline/index.ts";
import { useRuleOutline } from "./useRuleOutline.ts";
import { WriteNotice } from "./WriteNotice.tsx";

interface Props {
  id: string;
  username: string;
  actorId: number;
  csrf: string;
  onLostAccess: () => void;
  onSignOut: () => void;
}

export function PrivateWorkspace(props: Props) {
  const [channel, setChannel] = useState<WorkspaceChannel>();
  const { id, actorId, csrf, onLostAccess } = props;
  useEffect(() => {
    const abort = new AbortController();
    const instance = new WorkspaceChannel(
      workspaceApi(id, actorId, csrf, abort.signal),
      onLostAccess,
    );
    setChannel(instance);
    void instance.tick();
    const interval = window.setInterval(instance.tick, 1500);
    window.addEventListener("focus", instance.tick);
    window.addEventListener("online", instance.tick);
    return () => {
      instance.stop();
      abort.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", instance.tick);
      window.removeEventListener("online", instance.tick);
    };
  }, [id, actorId, csrf, onLostAccess]);
  return channel ? (
    <ConnectedOutline {...props} channel={channel} />
  ) : (
    <p role="status">Opening private workspace…</p>
  );
}

function ConnectedOutline({
  username,
  onSignOut,
  channel,
}: Props & { channel: WorkspaceChannel }) {
  const state = useSyncExternalStore(channel.subscribe, channel.getSnapshot);
  const snapshot = state.snapshot;
  const [currentView, setView] = useState<View>(inbox);
  const view =
    snapshot && viewExists(snapshot, currentView) ? currentView : inbox;
  const key = viewKey(view);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [collapsedRows, setCollapsed] = useState<Record<string, Set<string>>>(
    {},
  );
  const collapsed = collapsedRows[key] ?? new Set<string>();
  const [filters, setFilters] = useState<Record<string, Availability>>({});
  const availability = filters[key] ?? "everything";
  const projection = useRuleOutline(snapshot, view, availability, channel.tick);
  const rows = snapshot && projection.result ? projectedRows(snapshot, projection.result, collapsed) : [];
  const selection = visibleSelection(rows, selected[key] ?? []);
  const [showInspector, setShowInspector] = useState(
    () => window.innerWidth > 850,
  );
  const [mode, setMode] = useState<"inline" | "inspector">("inline");
  const [capture, setCapture] = useState(0);
  const drafts = useDraftBases(snapshot, selection);
  const observed = useRef<string | null>(null);
  useEffect(() => {
    const change = state.lastChange;
    if (
      !snapshot ||
      !change ||
      snapshot.revision < change.receipt.revision ||
      observed.current === change.receipt.operationId
    )
      return;
    observed.current = change.receipt.operationId;
    const ids = change.receipt.selection;
    if (!ids.length) return;
    if (change.intent.type === "project") {
      setView({ kind: "project", id: ids[0] });
      return;
    }
    if (change.intent.type === "folder") {
      setView({kind:"folder",id:ids[0]});
      return;
    }
    if (change.intent.type === "tag") {
      setView({ kind: "tag", id: ids[0] });
      return;
    }
    if (change.intent.type === "set-properties") return;
    const first = ids.find((id) =>
      snapshot.tasks.some((task) => task.id === id),
    );
    if (!first) return;
    const relocating = ["move", "capture", "group", "indent", "outdent"].includes(change.intent.type);
    const destination = relocating && !containsSelection(snapshot, view, ids)
      ? homeView(snapshot, first)
      : view;
    setView(destination);
    setSelected((previous) => ({ ...previous, [viewKey(destination)]: ids }));
  }, [state.lastChange, snapshot, view]);

  if (!snapshot)
    return (
      <main className="account-page">
        <section className="account-card">
          <p role="status">{state.message || "Loading private workspace…"}</p>
          <button onClick={() => channel.tick()}>Retry connection</button>
          <button onClick={onSignOut}>Sign out</button>
        </section>
      </main>
    );

  function run(command: Command) {
    const draft = drafts.forCommand(command);
    const accepted = channel.run(command, draft.base);
    if (accepted) draft.clear();
    return accepted;
  }

  const choose = (ids: string[]) => {
    setSelected((previous) => ({ ...previous, [key]: ids }));
  };

  const tagIntent = state.pending?.intent;
  const pendingTag =
    tagIntent?.type === "setTag" &&
    ["sending", "acknowledged", "uncertain", "retryable"].includes(state.phase)
      ? tagIntent
      : undefined;
  function controls(entry: Entry & RuleFields, kind: "project" | "group" | "action" | "folder") {
    const pending = tagIntent?.type === "set-properties" && tagIntent.ids.includes(entry.id) &&
      ["sending", "acknowledged", "uncertain", "retryable"].includes(state.phase) ? tagIntent.properties : undefined;
    return <RuleControls entry={entry} kind={kind} pending={pending} disabled={state.phase !== "ready"}
      change={(properties: Properties) => channel.run({type: "set-properties", ids:[entry.id], properties})} />;
  }
  const project = view.kind === "project" ? snapshot.projects.find(p => p.id === view.id) : undefined;
  const folder = view.kind === "folder" ? snapshot.folders?.find(f => f.id === view.id) : undefined;
  const task = selection.length === 1 ? snapshot.tasks.find(t => t.id === selection[0]) : undefined;
  return (
    <div {...drafts.bindings}>
      <Frame
        standardViews
        inspectorTools={task ? controls(task, task.kind) : undefined}
        mutationsDisabled={state.phase !== "ready"}
        pendingTag={pendingTag}
        workspace={snapshot}
        view={view}
        onView={next=>{
          if(view.kind==="inbox" && next.kind!=="inbox" && state.phase==="ready" && hasEligibleFiling(snapshot)) {
            channel.run({type:"lifecycle",change:{name:"file-inbox",payload:{}}},snapshot);
          }
          setView(next);
        }}
        selection={selection}
        onSelect={choose}
        run={run}
        onCapture={() => {
          setView(inbox);
          if (window.innerWidth <= 850) setShowInspector(false);
          setCapture((n) => n + 1);
        }}
        workspaceLabel={username}
        accountControls={<WorkspaceActions channel={channel} state={state} snapshot={snapshot} view={view} selection={selection} onSignOut={onSignOut}/>}
        inspectorOpen={showInspector}
        setInspectorOpen={setShowInspector}
        editMode={mode}
        setEditMode={setMode}
        message={state.message}
      >
        <WriteNotice state={state} channel={channel} />
        <Outline
          rows={rows}
          count={projection.result?.count}
          tools={<div className="private-outline-tools">
            <AvailabilityFilter value={availability} change={value => setFilters(current => ({...current, [key]:value}))}/>
            {project && controls(project, "project")}
            {folder && controls(folder, "folder")}
            {projection.message && <p role="alert">{projection.message} <button onClick={projection.retry}>Retry outline</button></p>}
          </div>}
          workspace={snapshot}
          view={view}
          selection={selection}
          onSelect={choose}
          run={run}
          collapsed={collapsed}
          onToggle={(id) => {
            const next = new Set(collapsed);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setCollapsed((previous) => ({ ...previous, [key]: next }));
          }}
          undo={() => {
            if (state.undo) channel.run({ type: "undo", receipt: state.undo });
          }}
          redo={() => {}}
          canUndo={Boolean(state.undo) && state.phase === "ready"}
          canRedo={false}
          captureSignal={capture}
          editMode={mode}
          onInspect={() => {
            setShowInspector(true);
            requestAnimationFrame(() =>
              document.getElementById("inspector-title")?.focus(),
            );
          }}
        />
      </Frame>
    </div>
  );
}
