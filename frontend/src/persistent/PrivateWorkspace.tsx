import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Frame } from "../components/Frame.tsx";
import { Outline } from "../components/Outline.tsx";
import {
  homeView,
  revealSelection,
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
import { AvailabilityFilter } from "./RuleControls.tsx";
import { projectedRows, visibleSelection } from "./rules.ts";
import type { Availability, RuleFields } from "./rules.ts";
import type { Entry } from "../outline/index.ts";
import { useClockRefresh } from "./useClockRefresh.ts";
import { DirectoryLinks } from "./DirectoryLinks.tsx";
import { ItemTools } from "./ItemTools.tsx";
import { useResolvedRows } from "./useResolvedRows.ts";
import { useRuleOutline } from "./useRuleOutline.ts";
import { BulkInspector } from "./preferences/BulkInspector.tsx";
import { usePersonalPreferences } from "./preferences/usePersonalPreferences.ts";
import { ContentTools } from "./content/ContentTools.tsx";
import { PlanningArea } from "./planning/PlanningArea.tsx";
import { usePlanningNavigation } from "./planning/usePlanningNavigation.ts";
import { useCatalog } from "./planning/useCatalog.ts";
import { WorkspaceTools } from "./tools/WorkspaceTools.tsx";
import type { WorkspaceInfo } from "./tools/WorkspaceRouter.tsx";
import { WriteNotice } from "./WriteNotice.tsx";

interface Props {
  id: string;
  username: string;
  actorId: number;
  csrf: string;
  readOnly?: boolean;
  activeSpace: WorkspaceInfo;
  spaces: WorkspaceInfo[];
  switchTo: (id?: string) => Promise<void>;
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
  actorId,
  id,
  csrf,
  readOnly = false,
  activeSpace, spaces, switchTo,
  onSignOut,
  channel,
}: Props & { channel: WorkspaceChannel }) {
  const state = useSyncExternalStore(channel.subscribe, channel.getSnapshot);
  const snapshot = state.snapshot;
  const catalog = useCatalog(snapshot, actorId, channel.refresh);
  const planning = usePlanningNavigation(catalog.data);
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
  const [cleanupEpoch, setCleanupEpoch] = useState(0);
  const cleanUp = () => setCleanupEpoch((value) => value + 1);
  const [travel, setTravel] = useState(false);
  const deviceZone = useClockRefresh(
    snapshot?.nextDateBoundary,
    channel.refresh,
  );
  const viewZone = travel ? deviceZone : "";
  const previousZone = useRef("");
  useEffect(() => {
    if (previousZone.current !== viewZone) {
      previousZone.current = viewZone;
      void channel.setViewZone(viewZone);
    }
  }, [channel, viewZone]);
  const projection = useRuleOutline(
    snapshot,
    actorId,
    view,
    availability,
    viewZone,
    channel.refresh,
    catalog.data?.personalVersion ?? 0,
  );
  const matches =
    snapshot && projection.result
      ? projectedRows(snapshot, projection.result, collapsed)
      : [];
  const rows = useResolvedRows({
    snapshot,
    result: projection.result,
    rows: matches,
    scope: JSON.stringify([actorId, key, availability, viewZone]),
    collapsed,
    cleanupEpoch,
  });

  const outlineSelection = visibleSelection(rows, selected[key] ?? []);
  const taskIds = new Set(snapshot?.tasks.map((item) => item.id));
  const selection = planning.page
    ? planning.selection.filter((id) => taskIds.has(id))
    : outlineSelection;
  const settings = usePersonalPreferences(id, actorId, csrf);
  const showInspector =
    settings.device.inspectorOpen ?? window.innerWidth > 850;
  const setShowInspector = (open: boolean) =>
    settings.setDevice({ inspectorOpen: open });
  const mode = settings.account.editMode;
  const setMode = (editMode: "inline" | "inspector") =>
    settings.setAccount({ editMode });
  const mutationsDisabled = readOnly || state.phase !== "ready";
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
      setView({ kind: "folder", id: ids[0] });
      return;
    }
    if (change.intent.type === "tag") {
      setView({ kind: "tag", id: ids[0] });
      return;
    }
    if (
      change.intent.type === "set-properties" ||
      (change.intent.type === "lifecycle" &&
        change.intent.change.name === "file-inbox")
    )
      return;
    const first = ids.find((id) =>
      snapshot.tasks.some((task) => task.id === id),
    );
    if (!first) return;
    const relocating = [
      "move",
      "capture",
      "group",
      "indent",
      "outdent",
    ].includes(change.intent.type);
    const destination =
      relocating && !containsSelection(snapshot, view, ids)
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
    if (planning.page) return planning.select(ids);
    setSelected((previous) => ({ ...previous, [key]: ids }));
  };

  const tagIntent = state.pending?.intent;
  const pendingTag =
    tagIntent?.type === "setTag" &&
    ["sending", "acknowledged", "uncertain", "retryable"].includes(state.phase)
      ? tagIntent
      : undefined;
  function showSource(id: string) {
    if (!snapshot) return;
    planning.close();
    if (snapshot.tags.some((item) => item.id === id))
      return setView({ kind: "tag", id });
    if (snapshot.projects.some((item) => item.id === id))
      return setView({ kind: "project", id });
    if (snapshot.folders?.some((item) => item.id === id))
      return setView({ kind: "folder", id });
    if (!snapshot.tasks.some((item) => item.id === id)) return;
    const destination = homeView(snapshot, id);
    const destinationKey = viewKey(destination);
    const memory = revealSelection(
      snapshot,
      destination,
      collapsedRows[destinationKey] ?? new Set(),
      [id],
    );
    setFilters((current) => ({ ...current, [destinationKey]: "everything" }));
    setCollapsed((current) => ({
      ...current,
      [destinationKey]: new Set(memory.collapsed),
    }));
    setSelected((current) => ({ ...current, [destinationKey]: [id] }));
    setView(destination);
  }

  function controls(
    entry: Entry & RuleFields,
    kind: "project" | "group" | "action" | "folder",
  ) {
    const pending =
      tagIntent?.type === "set-properties" &&
      tagIntent.ids.includes(entry.id) &&
      ["sending", "acknowledged", "uncertain", "retryable"].includes(
        state.phase,
      )
        ? tagIntent.properties
        : undefined;
    return (
      <ItemTools
        key={entry.id}
        actorId={actorId}
        showSource={showSource}
        entry={entry}
        kind={kind}
        snapshot={snapshot!}
        channel={channel}
        pending={pending}
        disabled={mutationsDisabled}
      />
    );
  }
  const project =
    view.kind === "project"
      ? snapshot.projects.find((p) => p.id === view.id)
      : undefined;
  const folder =
    view.kind === "folder"
      ? snapshot.folders?.find((f) => f.id === view.id)
      : undefined;
  const task =
    selection.length === 1
      ? snapshot.tasks.find((t) => t.id === selection[0])
      : undefined;
  function leaveInbox() {
    if (
      !planning.page &&
      view.kind === "inbox" &&
      !mutationsDisabled &&
      snapshot &&
      hasEligibleFiling(snapshot)
    ) {
      channel.run(
        { type: "lifecycle", change: { name: "file-inbox", payload: {} } },
        snapshot,
      );
    }
  }
  function openPlanning(target: string) {
    leaveInbox();
    planning.open(target, projection.result?.matchIds ?? [], outlineSelection);
  }
  const inspectorTools = task ? (
    <>
      {controls(task, task.kind)}
      <ContentTools
        key={task.id}
        snapshot={snapshot}
        itemId={task.id}
        readOnly={mutationsDisabled}
        actorId={actorId}
      />
    </>
  ) : selection.length > 1 ? (
    <BulkInspector
      snapshot={snapshot}
      ids={selection}
      channel={channel}
      disabled={mutationsDisabled}
    />
  ) : undefined;
  return (
    <div {...drafts.bindings}>
      <Frame
        standardViews
        personalPreferences={settings}
        planning={{
          active: planning.active,
          links: planning.links,
          open: openPlanning,
        }}
        inspectorTools={inspectorTools}
        mutationsDisabled={mutationsDisabled}
        pendingTag={pendingTag}
        workspace={snapshot}
        view={view}
        onView={(next) => {
          if (next.kind !== "inbox") leaveInbox();
          planning.close();
          setView(next);
        }}
        selection={selection}
        onSelect={choose}
        run={run}
        onCapture={() => {
          planning.close();
          setView(inbox);
          if (window.innerWidth <= 850) setShowInspector(false);
          setCapture((n) => n + 1);
        }}
        workspaceLabel={activeSpace.private ? username : activeSpace.name}
        accountControls={<>
          <WorkspaceTools actorId={actorId} csrf={csrf} workspace={activeSpace} spaces={spaces} snapshot={snapshot} selection={selection} switchTo={switchTo} refresh={channel.refresh} openItem={showSource}/>
          <WorkspaceActions
            readOnly={readOnly}
            actorId={actorId}
            channel={channel}
            state={state}
            snapshot={snapshot}
            view={view}
            selection={selection}
            onSignOut={onSignOut}
            travel={travel}
            deviceZone={deviceZone}
            setTravel={setTravel}
            cleanUp={cleanUp}
          />
        </>}
        inspectorOpen={showInspector}
        setInspectorOpen={setShowInspector}
        editMode={mode}
        setEditMode={setMode}
        message={state.message}
      >
        <WriteNotice state={state} channel={channel} />
        <PlanningArea
          session={{
            snapshot,
            actorId,
            refresh: channel.refresh,
            zone: viewZone,
          }}
          channel={channel}
          navigation={planning}
          catalog={catalog}
          disabled={mutationsDisabled}
          openSource={showSource}
          search={() => openPlanning("perspectives")}
        >
          <Outline
            mutationsDisabled={mutationsDisabled}
            rows={rows}
            count={projection.result?.count}
            retainedCount={Math.max(0, rows.length - matches.length)}
            tools={
              <div className="private-outline-tools">
                <AvailabilityFilter
                  value={availability}
                  change={(value) =>
                    setFilters((current) => ({ ...current, [key]: value }))
                  }
                />
                <DirectoryLinks
                  snapshot={snapshot}
                  view={view}
                  result={projection.result}
                  choose={setView}
                />
                {project && controls(project, "project")}
                {folder && controls(folder, "folder")}
                {projection.message && (
                  <p role="alert">
                    {projection.message}{" "}
                    <button onClick={projection.retry}>Retry outline</button>
                  </p>
                )}
              </div>
            }
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
              if (state.undo)
                channel.run({ type: "undo", receipt: state.undo });
            }}
            redo={() => {
              if (state.redo)
                channel.run({ type: "redo", receipt: state.redo });
            }}
            canUndo={Boolean(state.undo) && state.phase === "ready"}
            canRedo={Boolean(state.redo) && state.phase === "ready"}
            captureSignal={capture}
            editMode={mode}
            onInspect={() => {
              setShowInspector(true);
              requestAnimationFrame(() =>
                document.getElementById("inspector-title")?.focus(),
              );
            }}
          />
        </PlanningArea>
      </Frame>
    </div>
  );
}
