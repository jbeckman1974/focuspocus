import { useState } from "react";
import type { WorkspaceClient } from "./transport.ts";
import { useAction, useResource } from "./hooks.ts";
import { SecretValue } from "./SecretValue.tsx";

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
function RoleOptions() {
  return (
    <>
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </>
  );
}
export function Members({ client }: { client: WorkspaceClient }) {
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
        <SecretValue
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
