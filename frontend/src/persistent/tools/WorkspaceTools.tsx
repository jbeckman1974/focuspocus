import { Button, Select } from "@fluentui/react-components";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Snapshot } from "../api.ts";
import type { WorkspaceInfo } from "./WorkspaceRouter.tsx";
import { workspaceClient } from "./transport.ts";
import { Sharing } from "./Sharing.tsx";
import { ImportPanel } from "./ImportPanel.tsx";
import { ExportPanel } from "./ExportPanel.tsx";
import { CalendarPanel, ReminderPanel } from "./Integrations.tsx";
import { Nearby } from "./Nearby.tsx";
import "./tools.css";
import { workspaceOption } from "./workspaceNames.ts";

interface Props {
  actorId: number;
  csrf: string;
  workspace: WorkspaceInfo;
  switching: boolean;
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
          <Select
            size="small"
            aria-label="Active workspace"
            value={props.workspace.id}
            onChange={(e) =>
              void props.switchTo(e.target.value).catch(() => {})
            }
          >
            {props.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {workspaceOption(space, props.spaces)}
              </option>
            ))}
          </Select>
        </label>
      )}
      <Button
        type="button"
        appearance="subtle"
        size="small"
        onClick={() => setOpen(true)}
      >
        Workspace tools…
      </Button>
      {open && <ToolsDialog {...props} close={() => setOpen(false)} />}
    </>
  );
}
function ToolsDialog({
  actorId,
  csrf,
  workspace,
  switching,
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
    return () => abort.abort();
  }, [actorId, csrf, workspace.id]);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!switching) node?.showModal();
    return () => node?.close();
  }, [switching]);
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
