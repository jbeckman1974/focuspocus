import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { HttpError, jsonPost, jsonRequest, readSession } from "./api.ts";
import type { Session } from "./api.ts";
import { PrivateWorkspace } from "./PrivateWorkspace.tsx";
import "./persistent.css";

export function AccountApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const reconnect = useCallback(() => {
    setSession(null);
    setError("");
    setReload((n) => n + 1);
  }, []);

  useEffect(() => {
    const request = new AbortController();
    readSession(request.signal)
      .then((value) => {
        if (!request.signal.aborted) setSession(value);
      })
      .catch(() => {
        if (!request.signal.aborted)
          setError("The account service is unavailable.");
      });
    return () => request.abort();
  }, [reload]);

  if (!session)
    return (
      <main className="account-page">
        <section className="account-card">
          <h1>Task workspace</h1>
          <p role="status">{error || "Connecting…"}</p>
          {error && (
            <button type="button" onClick={reconnect}>
              Retry connection
            </button>
          )}
        </section>
      </main>
    );
  if (!session.user) return <SignIn session={session} onSession={setSession} />;
  const privateId = session.workspaces.find(
    (workspace) => workspace.role === "owner",
  )?.id;
  const signOut = async () => {
    try {
      const current = await readSession();
      if (current.user?.id !== session.user?.id) {
        setSession(current);
        return;
      }
      setSession(
        await jsonRequest<Session>(
          "/api/v1/logout",
          jsonPost(current.csrfToken, {}),
        ),
      );
      setError("");
    } catch {
      reconnect();
    }
  };
  if (!privateId)
    return (
      <main className="account-page">
        <section className="account-card">
          <h1>Private workspace unavailable</h1>
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </section>
      </main>
    );
  return (
    <PrivateWorkspace
      key={session.user.id + ":" + privateId}
      id={privateId}
      readOnly={session.workspaces.find((space) => space.id === privateId)?.role === "viewer"}
      actorId={session.user.id}
      username={session.user.username}
      csrf={session.csrfToken}
      onSignOut={signOut}
      onLostAccess={reconnect}
    />
  );
}

function SignIn({
  session,
  onSession,
}: {
  session: Session;
  onSession: (value: Session) => void;
}) {
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password") ?? "");
    const payload = recovery
      ? { token: String(fields.get("token") ?? ""), password }
      : { username: String(fields.get("username") ?? ""), password };
    setBusy(true);
    setMessage("");
    try {
      const path = recovery ? "/api/v1/recover" : "/api/v1/login";
      const result = await jsonRequest<Session>(
        path,
        jsonPost(session.csrfToken, payload),
      );
      form.reset();
      if (recovery) {
        setRecovery(false);
        setMessage("Password updated. Sign in with your new password.");
        onSession(await readSession());
      } else onSession(result);
    } catch (error) {
      setMessage(
        error instanceof HttpError
          ? error.message
          : "Unable to reach the account service.",
      );
      if (error instanceof HttpError && error.status === 403) {
        try {
          onSession(await readSession());
        } catch {
          /* A new submit will contact the service again. */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-page">
      <section className="account-card">
        <h1>{recovery ? "Recover access" : "Private task workspace"}</h1>
        <form onSubmit={submit} key={String(recovery)}>
          {recovery ? (
            <label>
              Recovery token
              <input name="token" type="password" autoComplete="off" required />
            </label>
          ) : (
            <label>
              Username
              <input
                name="username"
                autoComplete="username"
                required
                autoCapitalize="none"
              />
            </label>
          )}
          <label>
            {recovery ? "New password" : "Password"}
            <input
              name="password"
              type="password"
              autoComplete={recovery ? "new-password" : "current-password"}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {recovery ? "Reset password" : "Sign in"}
          </button>
        </form>
        <p role="status">{message}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRecovery(!recovery);
            setMessage("");
          }}
        >
          {recovery ? "Back to sign in" : "Use a recovery token"}
        </button>
        <a href="/sample/">Open the sample workspace</a>
      </section>
    </main>
  );
}
