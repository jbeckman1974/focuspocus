import { useEffect, useId, useRef, useState } from "react";
import type { Snapshot } from "../api.ts";
import type { WorkspaceInfo } from "./WorkspaceRouter.tsx";
import { workspaceClient } from "./transport.ts";
import { Sharing } from "./Sharing.tsx";
import { ImportPanel } from "./ImportPanel.tsx";
import { ExportPanel } from "./ExportPanel.tsx";
import { CalendarPanel, ReminderPanel } from "./Integrations.tsx";
import { Nearby } from "./Nearby.tsx";
import "./tools.css";

interface Props {
  actorId: number;
  csrf: string;
  workspace: WorkspaceInfo;
  spaces: WorkspaceInfo[];
  snapshot: Snapshot;
  selection: string[];
  focusVersion: number;
  switchTo: (id?: string) => Promise<void>;
  refresh: () => Promise<void>;
  openItem: (id: string) => void;
}
export function WorkspaceTools(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {props.spaces.length > 1 && (
        <label>
          Workspace{" "}
          <select
            aria-label="Active workspace"
            value={props.workspace.id}
            onChange={(e) =>
              void props.switchTo(e.target.value).catch(() => {})
            }
          >
            {props.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" onClick={() => setOpen(true)}>
        Workspace tools…
      </button>
      {open && <ToolsDialog {...props} close={() => setOpen(false)} />}
    </>
  );
}
function ToolsDialog({
  actorId,
  csrf,
  workspace,
  snapshot,
  selection,
  focusVersion,
  switchTo,
  refresh,
  openItem,
  close,
}: Props & { close: () => void }) {
  const [area, setArea] = useState("Sharing");
  const [client, setClient] = useState<ReturnType<typeof workspaceClient>>();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const abort = new AbortController();
    setClient(
      workspaceClient(
        { actorId, csrf, workspaceId: workspace.id },
        abort.signal,
      ),
    );
    const node = dialog.current;
    node?.showModal();
    return () => {
      abort.abort();
      node?.close();
    };
  }, [actorId, csrf, workspace.id]);
  const choose = async (id: string) => {
    await switchTo(id);
    if (client && !client.signal.aborted) close();
  };
  const areas = [
    "Sharing",
    ...(workspace.role === "owner" ? ["Import"] : []),
    "Export",
    "Calendars",
    "Reminders",
    "Nearby",
  ];
  return (
    <dialog
      ref={dialog}
      className="fp-dialog workspace-tools"
      aria-labelledby={heading}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={heading}>Workspace tools</h2>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      <nav aria-label="Workspace tools">
        {areas.map((name) => (
          <button
            key={name}
            type="button"
            aria-current={name === area ? "page" : undefined}
            onClick={() => setArea(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {client && (
        <section aria-label={area}>
          {area === "Sharing" && (
            <Sharing client={client} workspace={workspace} choose={choose} />
          )}
          {area === "Import" && (
            <ImportPanel
              client={client}
              snapshot={snapshot}
              refresh={refresh}
            />
          )}
          {area === "Export" && (
            <ExportPanel
              client={client}
              owner={workspace.role === "owner"}
              selection={selection}
              choose={choose}
            />
          )}
          {area === "Calendars" && <CalendarPanel client={client} />}
          {area === "Reminders" && (
            <ReminderPanel
              client={client}
              snapshot={snapshot}
              selected={selection}
            />
          )}
          {area === "Nearby" && (
            <Nearby
              client={client}
              snapshot={snapshot}
              editable={workspace.role !== "viewer"}
              focusVersion={focusVersion}
              openItem={(id) => {
                close();
                openItem(id);
              }}
            />
          )}
        </section>
      )}
    </dialog>
  );
}
