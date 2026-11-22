import { useEffect, useState } from "react";
import type { WorkspaceInfo } from "./WorkspaceRouter.tsx";
import type { WorkspaceClient } from "./transport.ts";
import { useAction, useResource } from "./hooks.ts";

interface Member {
  userId: number;
  username: string;
  role: string;
}
interface Invite {
  id: string;
  username: string;
  role: string;
  expiresAt: string;
}
interface Roster {
  version: number;
  members: Member[];
  invites: Invite[];
}
interface Key {
  id: string;
  label: string;
}

function RoleOptions() {
  return (
    <>
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </>
  );
}
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
      {workspace.role !== "viewer" && <Credentials client={client} />}
    </>
  );
}

function Reveal({
  value,
  label,
  clear,
}: {
  value: string;
  label: string;
  clear: () => void;
}) {
  useEffect(() => {
    function hidden() {
      if (document.hidden) clear();
    }
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [clear]);
  return (
    <fieldset>
      <legend>{label}</legend>
      <p>Copy this value now. Closing this view hides it.</p>
      <input
        className="secret"
        aria-label={label}
        readOnly
        autoComplete="off"
        value={value}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" onClick={clear}>
        Hide code
      </button>
    </fieldset>
  );
}
function Members({ client }: { client: WorkspaceClient }) {
  const roster = useResource<Roster>(client, "sharing/");
  const action = useAction();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("viewer");
  const [token, setToken] = useState("");
  const [removing, setRemoving] = useState<number>();
  const state = roster.data;
  const mutate = (path: string, values: object) =>
    void action.run(async () => {
      if (!state) return;
      try {
        await client.post("sharing/" + path, {
          ...values,
          expectedVersion: state.version,
        });
        setRemoving(undefined);
      } finally {
        roster.reload();
      }
    });
  return (
    <section aria-label="Workspace members">
      <h3>Members and invitations</h3>
      {state && (
        <>
          <ul>
            {state.members.map((m) => (
              <li key={m.userId}>
                {m.username}{" "}
                {m.role === "owner" ? (
                  "(Owner)"
                ) : (
                  <>
                    <select
                      aria-label={"Role for " + m.username}
                      value={m.role}
                      disabled={action.busy}
                      onChange={(e) =>
                        mutate("members/" + m.userId, { role: e.target.value })
                      }
                    >
                      <RoleOptions />
                    </select>{" "}
                    {removing === m.userId ? (
                      <>
                        <button
                          disabled={action.busy}
                          onClick={() =>
                            mutate("members/" + m.userId, { role: null })
                          }
                        >
                          Confirm removal
                        </button>{" "}
                        <button onClick={() => setRemoving(undefined)}>
                          Keep member
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setRemoving(m.userId)}>
                        Remove {m.username}
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                try {
                  const r = await client.post<{ token: string }>(
                    "sharing/invites",
                    {
                      username: username.trim(),
                      role,
                      expectedVersion: state.version,
                    },
                  );
                  setToken(r.token);
                  setUsername("");
                } finally {
                  roster.reload();
                }
              });
            }}
          >
            <label>
              Invite account{" "}
              <input
                value={username}
                required
                autoComplete="off"
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Invitation role{" "}
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <RoleOptions />
              </select>
            </label>
            <button disabled={action.busy || !username.trim()}>
              Create invitation
            </button>
          </form>
          <ul>
            {state.invites.map((i) => (
              <li key={i.id}>
                {i.username} · {i.role} · expires{" "}
                {new Date(i.expiresAt).toLocaleString()}{" "}
                <button
                  disabled={action.busy}
                  onClick={() => mutate("invites/" + i.id + "/revoke", {})}
                >
                  Revoke invitation for {i.username}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {token && (
        <Reveal
          label="New invitation code"
          value={token}
          clear={() => setToken("")}
        />
      )}
      {(roster.error || action.error) && (
        <p role="alert">
          {roster.error || action.error}{" "}
          <button onClick={roster.reload}>Refresh members</button>
        </p>
      )}
    </section>
  );
}
function Credentials({ client }: { client: WorkspaceClient }) {
  const keys = useResource<{ credentials: Key[] }>(
    client,
    "sharing/credentials",
  );
  const action = useAction();
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  return (
    <section aria-label="Capture credentials">
      <h3>Capture credentials</h3>
      <p>
        A credential can add items to this workspace’s Inbox. Revoke it when the
        external capture tool is no longer in use.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const r = await client.post<{ token: string }>(
              "sharing/credentials",
              { label: label.trim() },
            );
            setToken(r.token);
            setLabel("");
            keys.reload();
          });
        }}
      >
        <label>
          Credential name{" "}
          <input
            value={label}
            required
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button disabled={action.busy || !label.trim()}>
          Create capture credential
        </button>
      </form>
      {token && (
        <Reveal
          label="New capture credential"
          value={token}
          clear={() => setToken("")}
        />
      )}
      <ul>
        {keys.data?.credentials.map((k) => (
          <li key={k.id}>
            {k.label}{" "}
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await client.post(
                    "sharing/credentials/" + k.id + "/revoke",
                    {},
                  );
                  setToken("");
                  keys.reload();
                })
              }
            >
              Revoke {k.label}
            </button>
          </li>
        ))}
      </ul>
      {(keys.error || action.error) && (
        <p role="alert">
          {keys.error || action.error}{" "}
          <button onClick={keys.reload}>Refresh credentials</button>
        </p>
      )}
    </section>
  );
}
