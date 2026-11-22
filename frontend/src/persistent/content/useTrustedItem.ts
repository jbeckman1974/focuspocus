import { useEffect, useRef, useState } from "react";
import { HttpError, type Snapshot } from "../api.ts";
import { offlineEvents } from "../offline/storeEvents.ts";
import type { OfflineLease } from "../offline/storeTypes.ts";
import { contentLease, openTrustedContent, readSavedContent } from "./trustedItem.ts";

type SavedItem = Awaited<ReturnType<typeof readSavedContent>>;

export function useTrustedItem(enabled: boolean, actorId: number, snapshot: Snapshot, itemId: string) {
  const [item, setItem] = useState<SavedItem>();
  const [error, setError] = useState("");
  const current = useRef(snapshot);
  current.current = snapshot;
  const grantId = snapshot.offlineGrant?.id;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    let lease: OfflineLease | undefined;
    let pending = new Set<string>();
    let order = 0;
    let checkingServer = false;
    let denied = false;
    setError("");
    setItem(undefined);

    const refresh = async (network: boolean) => {
      if (denied || checkingServer) return;
      const ticket = ++order;
      checkingServer = network;
      try {
        lease ??= await contentLease(actorId, current.current);
        let data = network
          ? await openTrustedContent(lease, itemId, signal)
          : await readSavedContent(lease, itemId);
        if (signal.aborted || ticket !== order) return;
        const ids = new Set(data.pending.map((entry) => entry.id));
        const completed = [...pending].some((id) => !ids.has(id));
        pending = ids;
        if (!network && completed) {
          // The ack may replace a note or create a downloadable file.
          checkingServer = true;
          data = await openTrustedContent(lease, itemId, signal);
          if (signal.aborted || ticket !== order) return;
        }
        setItem(data);
        setError("");
      } catch (exception) {
        if (!signal.aborted && ticket === order) {
          denied = exception instanceof HttpError && [401,403,404].includes(exception.status);
          setItem(undefined);
          setError(exception instanceof Error ? exception.message : "Content unavailable.");
        }
      } finally {
        if (ticket === order) checkingServer = false;
      }
    };
    const changed = offlineEvents((kind) => {
      if (kind === "identity" || kind === "workspace") {
        // Remove the visible draft before inspecting the new grant.
        setItem(undefined);
        if (kind === "identity") {
          denied = true;
          order++;
          setError("Device identity changed. Reopen the workspace.");
          return;
        }
      }
      void refresh(false);
    });
    const reconnected = () => { void refresh(true); };
    window.addEventListener("online", reconnected);
    void refresh(true);
    return () => {
      controller.abort();
      changed();
      window.removeEventListener("online", reconnected);
    };
  }, [actorId, enabled, grantId, itemId, snapshot.generation, snapshot.workspaceId]);
  return enabled ? { item, error } : { item: undefined, error: "" };
}
