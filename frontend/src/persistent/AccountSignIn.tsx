import { useState, type FormEvent } from "react";
import {
  HttpError,
  jsonPost,
  jsonRequest,
  readSession,
  type Session,
} from "./api.ts";

export function SignIn({
  session,
  onSession,
}: {
  session: Session;
  onSession: (value: Session) => void;
}) {
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (session.authMode === "oidc")
    return (
      <main className="account-page">
        <section className="account-card">
          <h1>Private task workspace</h1>
          {new URLSearchParams(window.location.search).get("signin") ===
            "failed" && (
            <p role="alert">
              Provider sign-in failed. Check your account and second factor,
              then try again.
            </p>
          )}
          <form action="/api/v1/oidc/start" method="post">
            <input
              type="hidden"
              name="csrfmiddlewaretoken"
              value={session.csrfToken}
            />
            <button type="submit">Sign in with identity provider</button>
          </form>
        </section>
      </main>
    );

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
