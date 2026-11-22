import { useState } from "react";
import type { WorkspaceClient } from "./transport.ts";
import { useAction, useResource } from "./hooks.ts";
import { SecretValue } from "./SecretValue.tsx";

interface Key {
  id: string;
  label: string;
}

export function CaptureCredentials({ client }: { client: WorkspaceClient }) {
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
        <SecretValue
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
