import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Frame } from "../components/Frame.tsx";
import { Outline } from "../components/Outline.tsx";
import { homeView, inbox, reconcileSelection, viewExists, viewKey, containsSelection } from "../workspace/viewState.ts";
import type { View, Command } from "../outline/index.ts";
import { useDraftBases } from "./useDraftBases.ts";
import { workspaceApi } from "./api.ts";
import { WorkspaceChannel } from "./channel.ts";
import { NewEntry } from "./NewEntry.tsx";
import { WriteNotice } from "./WriteNotice.tsx";

interface Props {
  id: string;
  username: string;
  csrf: string;
  onLostAccess: () => void;
  onSignOut: () => void;
}

export function PrivateWorkspace(props: Props) {
  const [channel, setChannel] = useState<WorkspaceChannel>();
  const { id, csrf, onLostAccess } = props;
  useEffect(() => {
    const abort = new AbortController();
    const instance = new WorkspaceChannel(workspaceApi(id, csrf, abort.signal), onLostAccess);
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
  }, [id, csrf, onLostAccess]);
  return channel ? <ConnectedOutline {...props} channel={channel} /> : <p role="status">Opening private workspace…</p>;
}

function ConnectedOutline({ username, onSignOut, channel }: Props & { channel: WorkspaceChannel }) {
  const state = useSyncExternalStore(channel.subscribe, channel.getSnapshot);
  const snapshot = state.snapshot;
  const [currentView, setView] = useState<View>(inbox);
  const view = snapshot && viewExists(snapshot, currentView) ? currentView : inbox;
  const key = viewKey(view);
  const [selected, setSelected] = useState<Record<string,string[]>>({});
  const [collapsedRows, setCollapsed] = useState<Record<string, Set<string>>>({});
  const collapsed = collapsedRows[key] ?? new Set<string>();
  const selection = snapshot ? reconcileSelection(snapshot, view, collapsed, selected[key] ?? []).selection : [];
  const [showInspector, setShowInspector] = useState(() => window.innerWidth > 850);
  const [mode, setMode] = useState<"inline"|"inspector">("inline");
  const [capture, setCapture] = useState(0);
  const [entry, setEntry] = useState<"project"|"tag">();
  const drafts = useDraftBases(snapshot, selection);
  const observed = useRef<string | null>(null);
  useEffect(() => {
    const change = state.lastChange;
    if (!snapshot || !change || snapshot.revision < change.receipt.revision || observed.current === change.receipt.operationId) return;
    observed.current = change.receipt.operationId;
    const ids = change.receipt.selection;
    if (!ids.length) return;
    if (change.intent.type === "project") { setView({kind: "project", id: ids[0]}); return; }
    if (change.intent.type === "tag") { setView({kind: "tag", id: ids[0]}); return; }
    const first = ids.find(id=>snapshot.tasks.some(task=>task.id===id));
    if (!first) return;
    const destination = containsSelection(snapshot, view, ids) ? view : homeView(snapshot, first);
    setView(destination);
    setSelected(previous=>({...previous, [viewKey(destination)]: ids}));
  }, [state.lastChange, snapshot, view]);

  if (!snapshot) return <main className="account-page"><section className="account-card">
    <p role="status">{state.message || "Loading private workspace…"}</p>
    <button onClick={() => channel.tick()}>Retry connection</button>
    <button onClick={onSignOut}>Sign out</button>
  </section></main>;

  function run(command: Command) {
    const draft = drafts.forCommand(command);
    const accepted = channel.run(command, draft.base);
    if (accepted) draft.clear();
    return accepted;
  }

  const choose = (ids: string[]) => {
    setSelected(previous => ({...previous,[key]: ids}));
  };

  return <div {...drafts.bindings}>
    <Frame workspace={snapshot} view={view} onView={setView} selection={selection} onSelect={choose} run={run}
      onCapture={() => { setView(inbox); if (window.innerWidth <= 850) setShowInspector(false); setCapture(n=>n+1); }}
      workspaceLabel={username} accountControls={<div className="private-actions">
        <button disabled={state.phase !== "ready"} onClick={()=>setEntry("project")}>New project</button>
        <button disabled={state.phase !== "ready"} onClick={()=>setEntry("tag")}>New tag</button>
        <button onClick={() => { if (!state.pending || window.confirm("Leave this workspace with a pending change?")) onSignOut(); }}>Sign out</button>
      </div>}
      inspectorOpen={showInspector} setInspectorOpen={setShowInspector} editMode={mode} setEditMode={setMode} message={state.message}>
      <WriteNotice state={state} channel={channel} />
      <Outline workspace={snapshot} view={view} selection={selection} onSelect={choose} run={run}
        collapsed={collapsed} onToggle={id => {
          const next = new Set(collapsed);
          if (next.has(id)) next.delete(id); else next.add(id);
          setCollapsed(previous => ({...previous,[key]:next}));
        }}
        undo={() => { if (state.undo) channel.run({type:"undo",receipt:state.undo}); }}
        redo={()=>{}} canUndo={Boolean(state.undo) && state.phase === "ready"} canRedo={false}
        captureSignal={capture} editMode={mode} onInspect={()=>{
          setShowInspector(true);
          requestAnimationFrame(()=>document.getElementById("inspector-title")?.focus());
        }} />
      {entry && <NewEntry kind={entry} onCreate={title=>channel.run({type:entry,title})} onClose={()=>setEntry(undefined)} />}
    </Frame>
  </div>;
}
