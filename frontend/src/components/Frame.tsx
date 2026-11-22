import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Command, View, Workspace } from "../outline/index.ts";
import { Icon } from "./frame/Icon.tsx";
import { Inspector } from "./frame/Inspector.tsx";
import { Rail, Sidebar } from "./frame/Navigation.tsx";
import { PaneDivider } from "./frame/PaneDivider.tsx";
import { Preferences } from "./frame/Preferences.tsx";
import type { Appearance, EditMode } from "./frame/Preferences.tsx";
import "./frame/frame.css";

interface FrameProps {
  workspace: Workspace;
  view: View;
  onView: (view: View) => void;
  selection: string[];
  onSelect: (ids: string[]) => void;
  run: (command: Command) => boolean;
  onCapture: () => void;
  onReset?: () => void;
  workspaceLabel?: string;
  accountControls?: ReactNode;
  inspectorTools?: ReactNode;
  standardViews?: boolean;
  pendingTag?: Extract<Command, { type: "setTag" }>;
  mutationsDisabled?: boolean;
  children: ReactNode;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  editMode: EditMode;
  setEditMode: (mode: EditMode) => void;
  message: string;
}

function subscribeWidth(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const readWidth = () => window.innerWidth;

export function Frame({
  workspace,
  view,
  onView,
  selection,
  run,
  onCapture,
  onReset,
  workspaceLabel,
  accountControls,
  inspectorTools,
  standardViews,
  mutationsDisabled,
  pendingTag,
  children,
  inspectorOpen,
  setInspectorOpen,
  editMode,
  setEditMode,
  message,
}: FrameProps) {
  const width = useSyncExternalStore(subscribeWidth, readWidth, () => 1280);
  const compact = width <= 850;
  const [browseOpen, setBrowseOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>({
    theme: "system",
    density: "comfortable",
    textSize: "standard",
  });
  const [sidebarSize, setSidebarSize] = useState(212);
  const [inspectorSize, setInspectorSize] = useState(260);
  const browseToggle = useRef<HTMLButtonElement>(null);
  const inspectorToggle = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const lastPanel = useRef<"outline" | "browse" | "inspector">("outline");
  const previousCompact = useRef(compact);
  const inspectorVisible = inspectorOpen && (!compact || !browseOpen);
  const sidebarMax = Math.max(152, Math.min(340, Math.floor(width * 0.23)));
  const inspectorMax = Math.max(190, Math.min(400, Math.floor(width * 0.27)));
  const sidebarWidth = Math.min(sidebarSize, sidebarMax);
  const inspectorWidth = Math.min(inspectorSize, inspectorMax);
  const columns =
    `var(--rail-width) ${sidebarWidth}px 6px minmax(0, 1fr)` +
    (inspectorVisible ? ` 6px ${inspectorWidth}px` : "");

  useLayoutEffect(() => {
    if (compact && !previousCompact.current) {
      setBrowseOpen(lastPanel.current === "browse");
      setInspectorOpen(lastPanel.current === "inspector");
    }
    previousCompact.current = compact;
  }, [compact, setInspectorOpen]);

  function chooseView(next: View) {
    onView(next);
    if (compact) {
      setBrowseOpen(false);
      setInspectorOpen(false);
      requestAnimationFrame(() => {
        const active = main.current?.querySelector<HTMLElement>(
          "[role='tree'][tabindex='0']",
        );
        (active ?? main.current)?.focus();
      });
    }
  }

  function closeBrowse() {
    setBrowseOpen(false);
    browseToggle.current?.focus();
  }

  function toggleBrowse() {
    if (browseOpen) return closeBrowse();
    setInspectorOpen(false);
    setBrowseOpen(true);
    requestAnimationFrame(() => {
      const navigation = document.getElementById("workspace-navigation");
      const button =
        navigation?.querySelector<HTMLButtonElement>("[aria-current='page']") ??
        navigation?.querySelector<HTMLButtonElement>(".fp-nav-link");
      button?.focus();
    });
  }

  function closeInspector() {
    setInspectorOpen(false);
    inspectorToggle.current?.focus();
  }

  function toggleInspector() {
    if (inspectorVisible) return closeInspector();
    setBrowseOpen(false);
    setInspectorOpen(true);
    requestAnimationFrame(() =>
      document.getElementById("task-inspector")?.focus(),
    );
  }

  function capture() {
    if (compact) {
      setBrowseOpen(false);
      setInspectorOpen(false);
    }
    onCapture();
  }

  const navigation = {
    workspace,
    view,
    standardViews,
    onView: chooseView,
    onPreferences: () => setPreferencesOpen(true),
  };
  return (
    <div
      className="fp-shell"
      data-theme={appearance.theme}
      data-density={appearance.density}
      data-text-size={appearance.textSize}
    >
      <header className="fp-topbar">
        <div className="fp-wordmark">
          <span className="fp-brandmark" aria-hidden="true">
            <Icon name="mark" size={24} />
          </span>
          <span>{workspaceLabel ?? "Sample workspace"}</span>
        </div>
        <div className="fp-top-actions">
          {accountControls}
          {compact && (
            <button
              ref={browseToggle}
              type="button"
              className="fp-top-button"
              aria-label="Browse"
              aria-expanded={browseOpen}
              aria-controls="workspace-navigation"
              title="Browse"
              onClick={toggleBrowse}
            >
              <Icon name="browse" />
              <span>Browse</span>
            </button>
          )}
          <button
            type="button"
            className="fp-primary"
            aria-label="Add task"
            title="Add task"
            onClick={capture}
          >
            <Icon name="add" size={16} />
            <span>Add task</span>
          </button>
          <button
            ref={inspectorToggle}
            type="button"
            className="fp-top-button"
            aria-label="Inspector"
            aria-expanded={inspectorVisible}
            aria-controls="task-inspector"
            title="Inspector"
            onClick={toggleInspector}
          >
            <Icon name="inspector" />
            <span>Inspector</span>
          </button>
        </div>
      </header>
      <div
        className="fp-layout"
        style={compact ? undefined : { gridTemplateColumns: columns }}
      >
        {!compact && <Rail {...navigation} />}
        <div
          className="fp-panel-slot"
          hidden={compact && !browseOpen}
          onFocusCapture={() => {
            lastPanel.current = "browse";
          }}
          onKeyDown={(event) => {
            if (compact && event.key === "Escape") closeBrowse();
          }}
        >
          <Sidebar {...navigation} compact={compact} onClose={closeBrowse} />
        </div>
        {!compact && (
          <PaneDivider
            label="Resize navigation"
            controls="workspace-navigation"
            side="left"
            min={152}
            max={sidebarMax}
            size={sidebarWidth}
            setSize={setSidebarSize}
          />
        )}
        <main
          id="task-outline"
          ref={main}
          tabIndex={-1}
          className="fp-main"
          aria-label="Task outline"
          hidden={compact && (browseOpen || inspectorVisible)}
          onFocusCapture={() => {
            lastPanel.current = "outline";
          }}
        >
          {children}
        </main>
        {!compact && inspectorVisible && (
          <PaneDivider
            label="Resize inspector"
            controls="task-inspector"
            side="right"
            min={190}
            max={inspectorMax}
            size={inspectorWidth}
            setSize={setInspectorSize}
          />
        )}
        <div
          className="fp-panel-slot"
          hidden={!inspectorVisible}
          onFocusCapture={() => {
            lastPanel.current = "inspector";
          }}
        >
          <Inspector
            workspace={workspace}
            selection={selection}
            run={run}
            onClose={closeInspector}
            mutationsDisabled={mutationsDisabled}
            pendingTag={pendingTag}
            tools={inspectorTools}
          />
        </div>
      </div>
      <footer className="fp-statusbar">
        <span>
          {workspaceLabel
            ? "Private workspace"
            : "Sample data resets on reload"}
        </span>
        <span role="status" aria-live="polite" aria-atomic="true">
          {message}
        </span>
      </footer>
      {preferencesOpen && (
        <Preferences
          appearance={appearance}
          onAppearance={setAppearance}
          editMode={editMode}
          setEditMode={setEditMode}
          onClose={() => setPreferencesOpen(false)}
          onReset={
            onReset
              ? () => {
                  setPreferencesOpen(false);
                  onReset();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
