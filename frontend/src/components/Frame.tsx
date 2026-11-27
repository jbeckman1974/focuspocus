import { FluentProvider } from "@fluentui/react-components";
import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { Command, View, Workspace } from "../outline/index.ts";
import { WorkspaceToolbar } from "./frame/WorkspaceToolbar.tsx";
import { useWorkspaceTheme } from "./frame/workspaceTheme.ts";
import { Inspector } from "./frame/Inspector.tsx";
import type { PlanningNavigation } from "./frame/Navigation.tsx";
import { Rail, Sidebar } from "./frame/Navigation.tsx";
import { PaneDivider } from "./frame/PaneDivider.tsx";
import { Preferences } from "./frame/Preferences.tsx";
import type { Appearance, EditMode } from "./frame/Preferences.tsx";
import "./frame/frame.css";
import "./frame/fluent.css";

import type { PersonalSettings } from "../persistent/preferences/types.ts";
import { PersonalControls } from "../persistent/preferences/PersonalControls.tsx";
import { CompletionShortcut } from "./frame/shortcuts.ts";

interface FrameProps {
  personalPreferences?: PersonalSettings;
  workspace: Workspace;
  view: View;
  openedDestination?: string;
  onView: (view: View) => void;
  selection: string[];
  onSelect: (ids: string[]) => void;
  run: (command: Command) => boolean | Promise<boolean>;
  onCapture: () => void;
  onReset?: () => void;
  workspaceLabel?: string;
  accountControls?: ReactNode;
  inspectorTools?: ReactNode;
  standardViews?: boolean;
  planning?: PlanningNavigation;
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
  personalPreferences,
  view,
  openedDestination,
  onView,
  selection,
  run,
  onCapture,
  onReset,
  workspaceLabel,
  accountControls,
  inspectorTools,
  standardViews,
  planning,
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
  const [sampleAppearance, setSampleAppearance] = useState<Appearance>({
    theme: "system",
    density: "comfortable",
    textSize: "standard",
  });
  const [sampleSidebarSize, setSampleSidebarSize] = useState(212);
  const [sampleInspectorSize, setSampleInspectorSize] = useState(260);
  const appearance = personalPreferences?.account ?? sampleAppearance;
  const { theme, colorScheme } = useWorkspaceTheme(appearance.theme);
  const preferencesTrigger = useRef<HTMLElement | null>(null);
  const sidebarSize =
    personalPreferences?.device.sidebarSize ?? sampleSidebarSize;
  const inspectorSize =
    personalPreferences?.device.inspectorSize ?? sampleInspectorSize;
  const setSidebarSize = (value: number) =>
    personalPreferences
      ? personalPreferences.setDevice({ sidebarSize: value })
      : setSampleSidebarSize(value);
  const setInspectorSize = (value: number) =>
    personalPreferences
      ? personalPreferences.setDevice({ inspectorSize: value })
      : setSampleInspectorSize(value);
  const browseToggle = useRef<HTMLButtonElement>(null);
  const inspectorToggle = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const lastPanel = useRef<"outline" | "browse" | "inspector">("outline");
  const previousCompact = useRef(compact);
  const lastOpenedDestination = useRef(openedDestination);
  const inspectorVisible = inspectorOpen && (!compact || !browseOpen);
  const sidebarMax = Math.max(152, Math.min(340, Math.floor(width * 0.23)));
  const inspectorMax = Math.max(190, Math.min(400, Math.floor(width * 0.27)));
  const sidebarWidth = Math.min(sidebarSize, sidebarMax);
  const inspectorWidth = Math.min(inspectorSize, inspectorMax);
  const columns =
    `${sidebarWidth}px 6px minmax(0, 1fr)` +
    (inspectorVisible ? ` 6px ${inspectorWidth}px` : "");

  useLayoutEffect(() => {
    if (compact && !previousCompact.current) {
      setBrowseOpen(lastPanel.current === "browse");
      setInspectorOpen(lastPanel.current === "inspector");
    }
    previousCompact.current = compact;
  }, [compact, setInspectorOpen]);

  const closePanelsForCreation = useEffectEvent(() => {
    setBrowseOpen(false);
    if (inspectorOpen) setInspectorOpen(false);
  });

  useLayoutEffect(() => {
    if (lastOpenedDestination.current === openedDestination) return;
    lastOpenedDestination.current = openedDestination;
    if (!compact || !openedDestination) return;
    const dialog = document.querySelector<HTMLDialogElement>(
      ".fp-workspace-menu dialog[open]",
    );
    closePanelsForCreation();
    function focusDestination() {
      const content = main.current;
      const active = document.activeElement;
      if (
        !content ||
        content.hidden ||
        document.querySelector("dialog[open]") ||
        (active &&
          active !== document.body &&
          !active.closest(
            ".fp-workspace-menu, #workspace-navigation, #task-inspector",
          ))
      )
        return;
      (content.querySelector<HTMLElement>('[role="tree"]') ?? content).focus();
    }
    const focus = requestAnimationFrame(() => {
      if (dialog?.open && dialog.isConnected)
        dialog.addEventListener("close", focusDestination, { once: true });
      else focusDestination();
    });
    return () => {
      cancelAnimationFrame(focus);
      dialog?.removeEventListener("close", focusDestination);
    };
  }, [compact, openedDestination]);

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

  function openPreferences(trigger: HTMLElement) {
    preferencesTrigger.current = trigger;
    setPreferencesOpen(true);
  }

  useLayoutEffect(() => {
    if (!preferencesOpen && preferencesTrigger.current) {
      const trigger = preferencesTrigger.current;
      preferencesTrigger.current = null;
      const target = trigger.getClientRects().length
        ? trigger
        : (browseToggle.current ?? main.current);
      target?.focus({ preventScroll: true });
    }
  }, [preferencesOpen]);

  const navigation = {
    workspace,
    view,
    standardViews,
    planning: planning && {
      ...planning,
      open: (id: string) => {
        planning.open(id);
        if (compact) {
          setBrowseOpen(false);
          setInspectorOpen(false);
          requestAnimationFrame(() => main.current?.focus());
        }
      },
    },
    onView: chooseView,
    onPreferences: openPreferences,
  };
  return (
    <CompletionShortcut.Provider
      value={personalPreferences?.account.shortcut ?? "x"}
    >
      <FluentProvider
        theme={theme}
        data-motion={personalPreferences?.account.motion ?? "system"}
        className="fp-shell"
        data-theme={appearance.theme}
        data-color-scheme={colorScheme}
        data-density={appearance.density}
        data-text-size={appearance.textSize}
      >
        <WorkspaceToolbar
          label={workspaceLabel}
          accountControls={accountControls}
          compact={compact}
          narrow={width <= 600}
          openedDestination={openedDestination}
          captureDisabled={mutationsDisabled}
          browseOpen={browseOpen}
          inspectorOpen={inspectorVisible}
          browseToggle={browseToggle}
          inspectorToggle={inspectorToggle}
          onBrowse={toggleBrowse}
          onInspector={toggleInspector}
          onCapture={capture}
        />
        <div
          className="fp-layout"
          style={compact ? undefined : { gridTemplateColumns: columns }}
        >
          <div
            className="fp-panel-slot fp-navigation-slot"
            id="workspace-navigation"
            hidden={compact && !browseOpen}
            onFocusCapture={() => {
              lastPanel.current = "browse";
            }}
            onKeyDown={(event) => {
              if (compact && event.key === "Escape") closeBrowse();
            }}
          >
            {!compact && <Rail {...navigation} />}
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
          {personalPreferences?.retry && (
            <button onClick={(event) => openPreferences(event.currentTarget)}>
              Review preference changes
            </button>
          )}
          <span role="status" aria-live="polite" aria-atomic="true">
            {message}
          </span>
        </footer>
        {preferencesOpen && (
          <Preferences
            appearance={appearance}
            colorScheme={colorScheme}
            motion={personalPreferences?.account.motion ?? "system"}
            onAppearance={
              personalPreferences
                ? personalPreferences.setAccount
                : (patch) =>
                    setSampleAppearance((current) => ({ ...current, ...patch }))
            }
            controls={
              personalPreferences ? (
                <PersonalControls settings={personalPreferences} />
              ) : undefined
            }
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
      </FluentProvider>
    </CompletionShortcut.Provider>
  );
}
