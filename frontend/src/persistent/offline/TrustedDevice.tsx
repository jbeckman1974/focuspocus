import { createContext, useContext, useEffect, useState } from "react";
import { actorRequest, type Snapshot } from "../api.ts";
import type { WorkspaceInfo } from "../tools/WorkspaceRouter.tsx";
import { ensureAppWorker } from "../../pwa/registration.ts";
import {
  cancelEnrollment,
  enableOffline,
  reserveEnrollment,
  offlineEvents,
  offlineLease,
  type OfflineLease,
} from "./store.ts";

interface OfflineIdentity {
  epoch: string;
  actorId: number | null;
  initialSpace: WorkspaceInfo | null;
  offlineBootstrap: boolean;
}

const unavailable: OfflineIdentity = {
  epoch: "",
  actorId: null,
  initialSpace: null,
  offlineBootstrap: false,
};
export const OfflineIdentityContext =
  createContext<OfflineIdentity>(unavailable);
export const useOfflineIdentity = () => useContext(OfflineIdentityContext);

function sameLease(a: OfflineLease | null, b: OfflineLease | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.actorId === b.actorId &&
      a.workspaceId === b.workspaceId &&
      a.epoch === b.epoch &&
      a.grantId === b.grantId &&
      a.generation === b.generation)
  );
}

export function useWorkspaceLease(actorId: number, workspaceId: string) {
  const { epoch } = useOfflineIdentity();
  const [state, setState] = useState<{
    key: string;
    lease: OfflineLease | null;
    loading: boolean;
  }>({ key: "", lease: null, loading: true });
  const key = JSON.stringify([epoch, actorId, workspaceId]);
  useEffect(() => {
    let active = true,
      serial = 0;
    async function refresh() {
      const order = ++serial;
      const lease = epoch
        ? await offlineLease(actorId, workspaceId).catch(() => null)
        : null;
      if (!active || order !== serial) return;
      const valid = lease?.epoch === epoch ? lease : null;
      setState((old) =>
        old.key === key && !old.loading && sameLease(old.lease, valid)
          ? old
          : { key, lease: valid, loading: false },
      );
    }
    void refresh();
    const stop = offlineEvents((event) => {
      if (event !== "data") void refresh();
    });
    return () => {
      active = false;
      stop();
    };
  }, [key, actorId, workspaceId, epoch]);
  return state.key === key ? state : { lease: null, loading: true };
}

export function TrustDeviceControl({
  actor,
  space,
  snapshot,
}: {
  actor: { id: number; username: string };
  space: WorkspaceInfo;
  snapshot: Snapshot | null;
}) {
  const binding = useOfflineIdentity();
  const { lease, loading } = useWorkspaceLease(actor.id, space.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (lease)
    return <span role="status">Offline editing enabled on this device.</span>;
  async function enable() {
    if (busy || !snapshot || binding.offlineBootstrap) return;
    setBusy(true);
    setError("");
    let reservation: string | undefined;
    try {
      if (!binding.epoch)
        throw new Error("This browser profile cannot store offline data.");
      reservation = await reserveEnrollment(actor.id, space, binding.epoch);
      await ensureAppWorker();
      const current = await actorRequest<Snapshot>(
        actor.id,
        "/api/v1/workspaces/" +
          encodeURIComponent(space.id) +
          "/snapshot" +
          (snapshot.viewZone
            ? "?viewZone=" + encodeURIComponent(snapshot.viewZone)
            : ""),
      );
      if (
        !current.offlineGrant ||
        current.offlineGrant.id !== snapshot.offlineGrant?.id ||
        current.generation !== snapshot.generation
      )
        throw new Error(
          "Workspace access changed. Reopen the workspace before enabling offline editing.",
        );
      await enableOffline(actor, space, current, binding.epoch, reservation);
      reservation = undefined;
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === "QuotaExceededError"
          ? "The browser storage quota is full. Free some space before enabling offline editing."
          : cause instanceof Error
            ? cause.message
            : "Offline storage could not be enabled.",
      );
    } finally {
      if (reservation)
        await cancelEnrollment(
          actor.id,
          space.id,
          binding.epoch,
          reservation,
        ).catch(() => {});
      setBusy(false);
    }
  }
  return (
    <span>
      <button
        type="button"
        onClick={() => void enable()}
        disabled={busy || loading || !snapshot || binding.offlineBootstrap}
      >
        Enable offline editing on this device
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
