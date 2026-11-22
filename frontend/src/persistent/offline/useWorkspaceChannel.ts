import { useEffect, useState } from "react";
import { workspaceApi } from "../api.ts";
import { WorkspaceChannel } from "../channel.ts";
import { useOfflineIdentity, useWorkspaceLease } from "./TrustedDevice.tsx";
import { lockOfflineActor, type OfflineLease } from "./store.ts";

export function useWorkspaceChannel(
  id: string,
  actorId: number,
  csrf: string,
  lostAccess: () => void,
) {
  const { epoch } = useOfflineIdentity();
  const { lease, loading } = useWorkspaceLease(actorId, id);
  const [connected, setConnected] = useState<{
    channel: WorkspaceChannel;
    lease: OfflineLease | null;
  }>();
  useEffect(() => {
    if (loading) return;
    const abort = new AbortController();
    const denied = async (status?: number) => {
      if (abort.signal.aborted) return;
      if (status === 401) {
        try {
          await lockOfflineActor(actorId, epoch);
        } catch {
          // The account screen must still mask this session when storage fails.
        }
      }
      if (!abort.signal.aborted) lostAccess();
    };
    const channel = new WorkspaceChannel(
      workspaceApi(id, actorId, csrf, abort.signal),
      denied,
      lease ?? undefined,
    );
    setConnected({ channel, lease });
    void channel.tick();
    const timer = window.setInterval(channel.tick, 1500);
    window.addEventListener("focus", channel.tick);
    window.addEventListener("online", channel.tick);
    window.addEventListener("offline", channel.tick);
    return () => {
      channel.stop();
      abort.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", channel.tick);
      window.removeEventListener("online", channel.tick);
      window.removeEventListener("offline", channel.tick);
    };
  }, [actorId, id, csrf, epoch, lease, loading, lostAccess]);
  return !loading && connected?.lease === lease ? connected : undefined;
}
