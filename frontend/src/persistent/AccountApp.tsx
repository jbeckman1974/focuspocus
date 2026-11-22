import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { SignIn } from "./AccountSignIn.tsx";
import { WorkspaceRouter } from "./tools/WorkspaceRouter.tsx";
import { OfflineIdentityContext } from "./offline/TrustedDevice.tsx";
import { openAccount, type AccountState } from "./offline/accountIdentity.ts";
import { beginLogout, offlineEvents, pendingSpaces } from "./offline/store.ts";
import "./persistent.css";

export function AccountApp() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [prompt, setPrompt] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [remaining, setRemaining] = useState("");
  const allowOffline = useRef(true);
  const signOutBusy = useRef(false);
  const reconnect = useCallback((offline = false, continueSync = false) => {
    allowOffline.current = offline;
    setAccount(null);
    setError("");
    setPrompt(false);
    if (!continueSync) setSyncing(null);
    setRemaining("");
    setReload((n) => n + 1);
  }, []);
  const lostAccess = useCallback(() => reconnect(false), [reconnect]);
  useEffect(() => {
    const request = new AbortController();
    void openAccount(request.signal, allowOffline.current)
      .then((value) => {
        if (!request.signal.aborted) setAccount(value);
      })
      .catch((cause) => {
        if (!request.signal.aborted)
          setError(
            cause instanceof Error && !(cause instanceof TypeError)
              ? cause.message
              : "The account service is unavailable.",
          );
      });
    return () => request.abort();
  }, [reload]);
  useEffect(() => {
    // A back/forward cache entry can stay frozen while a different tab logs out.
    // Store a locked screen in the browser snapshot and use the ordinary identity
    // handshake before mounting a private workspace on restoration.
    const hide = (event: PageTransitionEvent) => {
      if (event.persisted)
        flushSync(() => {
          setAccount(null);
          setError("");
        });
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) reconnect(true);
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    const unsubscribe = offlineEvents((kind, remote) => {
      if (remote && kind === "identity") reconnect(false);
    });
    const online = () => {
      if (!account || account.offlineBootstrap) reconnect(false, true);
    };
    window.addEventListener("online", online);
    return () => {
      unsubscribe();
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [account, reconnect]);
  useEffect(() => {
    if (!account?.offlineBootstrap || !account.expiresAt) return;
    const expiry = account.expiresAt;
    let timer = 0;
    function check() {
      const left = expiry - Date.now();
      if (left <= 0) {
        reconnect(false);
        return;
      }
      timer = window.setTimeout(check, Math.min(left, 2_000_000_000));
    }
    check();
    return () => window.clearTimeout(timer);
  }, [account, reconnect]);

  const requestLogout = useCallback(
    async (discard = false) => {
      const actor = account?.session.user;
      if (!actor || signOutBusy.current) return;
      signOutBusy.current = true;
      try {
        const result = await beginLogout(actor.id, account.epoch, discard);
        if (result === "pending") {
          setPrompt(true);
          return;
        }
        reconnect(false);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Sign-out could not finish.",
        );
      } finally {
        signOutBusy.current = false;
      }
    },
    [account, reconnect],
  );
  useEffect(() => {
    const actor = account?.session.user;
    if (!syncing || !actor || !account) return;
    if (syncing !== actor.id) {
      setSyncing(null);
      return;
    }
    let active = true;
    async function check() {
      try {
        const rows = await pendingSpaces(actor!.id, account!.epoch);
        if (!active) return;
        if (!rows.length) {
          await requestLogout();
          return;
        }
        setRemaining(
          rows.map((row) => row.name + " (" + row.count + ")").join(", "),
        );
      } catch {
        if (active) reconnect(false);
      }
    }
    void check();
    const unsub = offlineEvents(() => void check());
    return () => {
      active = false;
      unsub();
    };
  }, [syncing, account, requestLogout, reconnect]);

  if (!account)
    return (
      <main className="account-page">
        <section className="account-card">
          <h1>Task workspace</h1>
          <p role="status">{error || "Connecting…"}</p>
          {error && (
            <button
              type="button"
              onClick={() => reconnect(allowOffline.current)}
            >
              Retry connection
            </button>
          )}
        </section>
      </main>
    );
  const { session } = account;
  if (!session.user) return <SignIn session={session} onSession={lostAccess} />;
  return (
    <OfflineIdentityContext.Provider
      value={{
        epoch: account.epoch,
        actorId: session.user.id,
        initialSpace: account.initialSpace,
        offlineBootstrap: account.offlineBootstrap,
      }}
    >
      {error && <p role="alert">{error}</p>}
      {syncing === session.user.id && (
        <aside role="status">
          Open each pending workspace while connected to sync before signing
          out. {remaining}{" "}
          <button onClick={() => setSyncing(null)}>Cancel sign-out</button>
        </aside>
      )}
      {prompt && (
        <PendingLogout
          onCancel={() => setPrompt(false)}
          onDiscard={() => void requestLogout(true)}
          onSync={() => {
            setPrompt(false);
            setSyncing(session.user!.id);
          }}
        />
      )}
      <WorkspaceRouter
        key={session.user.id}
        actorId={session.user.id}
        username={session.user.username}
        csrf={session.csrfToken}
        onSignOut={() => void requestLogout()}
        onLostAccess={lostAccess}
      />
    </OfflineIdentityContext.Provider>
  );
}

function PendingLogout({
  onCancel,
  onDiscard,
  onSync,
}: {
  onCancel: () => void;
  onDiscard: () => void;
  onSync: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-label="Pending offline changes" onCancel={onCancel}>
      <h2>Pending offline changes</h2>
      <p>
        Signing out clears this account’s drafts and files from this browser.
      </p>
      <button type="button" onClick={onSync}>
        Sync before signing out
      </button>
      <button type="button" onClick={onDiscard}>
        Discard changes and sign out
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </dialog>
  );
}
