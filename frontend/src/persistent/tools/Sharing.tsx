import { useState } from "react";
import type { WorkspaceInfo } from "./WorkspaceRouter.tsx";
import type { WorkspaceClient } from "./transport.ts";
import { useAction } from "./hooks.ts";
import { Members } from "./Members.tsx";
import { CaptureCredentials } from "./CaptureCredentials.tsx";

export function Sharing({
  client,
  workspace,
  choose,
}: {
  client: WorkspaceClient;
  workspace: WorkspaceInfo;
  choose: (id: string) => Promise<void>;
}) {
  const action = useAction();
  const [newName, setName] = useState("");
  const [createId, setCreateId] = useState(() => crypto.randomUUID());
  const [invitation, setInvitation] = useState("");
  return (
    <>
      <h3>Workspaces</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const r = await client.post<{ workspaceId: string }>(
              "/api/v1/sharing/workspaces",
              { id: createId, name: newName.trim() },
            );
            await choose(r.workspaceId);
          });
        }}
      >
        <label>
          Shared workspace name{" "}
          <input
            value={newName}
            maxLength={120}
            required
            onChange={(e) => {
              setName(e.target.value);
              setCreateId(crypto.randomUUID());
            }}
          />
        </label>
        <button disabled={action.busy || !newName.trim()}>
          Create shared workspace
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const r = await client.post<{ workspaceId: string }>(
              "/api/v1/sharing/accept",
              { token: invitation.trim() },
            );
            setInvitation("");
            await choose(r.workspaceId);
          });
        }}
      >
        <label>
          Invitation code{" "}
          <input
            type="password"
            autoComplete="off"
            value={invitation}
            required
            onChange={(e) => setInvitation(e.target.value)}
          />
        </label>
        <button disabled={action.busy || !invitation.trim()}>
          Accept invitation
        </button>
      </form>
      {action.error && <p role="alert">{action.error}</p>}
      {!workspace.private && workspace.role === "owner" && (
        <Members client={client} />
      )}
      {workspace.role !== "viewer" && <CaptureCredentials client={client} />}
    </>
  );
}

