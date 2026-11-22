import { useCallback, useEffect, useRef, useState } from "react";
import { actorRequest, HttpError } from "../api.ts";
import { PrivateWorkspace } from "../PrivateWorkspace.tsx";

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  private: boolean;
}
export function WorkspaceRouter({
  actorId,
  username,
  csrf,
  onLostAccess,
  onSignOut,
}: {
  actorId: number;
  username: string;
  csrf: string;
  onLostAccess: () => void;
  onSignOut: () => void;
}) {
  const [spaces, setSpaces] = useState<WorkspaceInfo[]>();
  const [active, setActive] = useState("");
  const [error, setError] = useState("");
  const [switching,setSwitching]=useState(false);
  const [failedTarget,setFailedTarget]=useState<string>();
  const controller = useRef<AbortController | undefined>(undefined);
  const sequence = useRef(0);
  const changing = useRef(false);
  const switchTo = useCallback(
    async (requested?: string) => {
      const signal = controller.current?.signal;
      if (!signal || signal.aborted || (!requested && changing.current)) return;
      if (requested) { changing.current = true; setSwitching(true); setFailedTarget(undefined); }
      const order = ++sequence.current;
      try {
        const result = await actorRequest<{ workspaces: WorkspaceInfo[] }>(
          actorId,
          "/api/v1/sharing/workspaces",
          { signal },
        );
        if (signal.aborted || order !== sequence.current) return;
        if (requested && !result.workspaces.some((s) => s.id === requested))
          throw new Error("Workspace access changed.");
        setSpaces(result.workspaces);
        setActive(
          (current) =>
            result.workspaces.find((s) => s.id === (requested ?? current))
              ?.id ??
            result.workspaces.find((s) => s.private)?.id ??
            result.workspaces[0]?.id ??
            "",
        );
        setError("");
      } catch (e) {
        if (signal.aborted || order !== sequence.current) return;
        if (e instanceof HttpError && [401, 403].includes(e.status))
          onLostAccess();
        else {
          setError("Unable to refresh your workspaces.");
          if (requested) {setFailedTarget(requested);throw e;}
        }
      } finally {
        if (requested && order === sequence.current && !signal.aborted) { changing.current = false;setSwitching(false); }
      }
    },
    [actorId, onLostAccess],
  );
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const refresh = () => {
      if (!document.hidden) void switchTo();
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [switchTo]);
  const selected = spaces?.find((s) => s.id === active);
  if (!selected)
    return (
      <main className="account-page">
        <section className="account-card">
          <p role="status">
            {error ||
              (spaces
                ? "No accessible workspace."
                : "Opening your workspaces…")}
          </p>
          <button onClick={() => void switchTo()}>Refresh workspaces</button>
          <button onClick={onSignOut}>Sign out</button>
        </section>
      </main>
    );
  return (
    <>
      {switching && <p role="status">Switching workspace…</p>}
      {!switching && failedTarget && <p role="alert">Could not open the requested workspace. Your current workspace is still open.{" "}
        <button onClick={()=>void switchTo(failedTarget).catch(()=>{})}>Retry workspace switch</button>{" "}
        <button onClick={()=>{setFailedTarget(undefined);setError("");}}>Stay here</button>
      </p>}
      {!switching && error && !failedTarget && <p role="status">{error} <button onClick={()=>void switchTo()}>Refresh workspaces</button></p>}
      <div hidden={switching} inert={switching}>
      <PrivateWorkspace
        key={selected.id + ":" + selected.role}
        id={selected.id}
        username={username}
        actorId={actorId}
        csrf={csrf}
        readOnly={selected.role === "viewer"}
        activeSpace={selected}
        spaces={spaces!}
        switching={switching}
        switchTo={switchTo}
        onLostAccess={onLostAccess}
        onSignOut={onSignOut}
      />
      </div>
    </>
  );
}
