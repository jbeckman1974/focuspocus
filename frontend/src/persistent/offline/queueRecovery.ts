import type { Snapshot } from "../api.ts";
import { markConflict, type QueueData } from "./queue.ts";
import {
  supportedQueue,
  type QueueEntry,
  type ReviewedContent,
} from "./queueTypes.ts";
import {
  OfflineAccessError,
  rebindOffline,
  syncOfflineLease,
  type OfflineLease,
} from "./store.ts";

// Reset only projections and execution authority at a recovery boundary.
// The user can still compare every supported draft and deliberately keep or discard its bytes.
export function quarantine(
  old: QueueData,
  next: QueueData,
  boundary: "generation" | "protocol",
) {
  if (!supportedQueue(old.queue)) throw new OfflineAccessError("protocol");
  next.queue = old.queue;
  for (const entry of next.queue) {
    markConflict(
      entry,
      boundary === "generation"
        ? "Database restored. Compare this draft with the new workspace before reapplying."
        : "Offline format changed. Compare this draft with the current workspace before reapplying.",
    );
    if (old.files[entry.id]) next.files[entry.id] = old.files[entry.id];
  }
}

export async function synchronizeLease(
  lease: OfflineLease,
  current: Snapshot,
): Promise<OfflineLease | null> {
  try {
    return await syncOfflineLease(lease, current);
  } catch (error) {
    if (
      !(error instanceof OfflineAccessError) ||
      (error.code !== "generation" && error.code !== "protocol")
    )
      throw error;
    if (current.offlineGrant?.protocol !== 1) return null;
    const boundary = error.code;
    try {
      return await rebindOffline<QueueEntry, void>(
        lease,
        current,
        (old, next) => quarantine(old, next, boundary),
      );
    } catch (incompatible) {
      if (
        incompatible instanceof OfflineAccessError &&
        incompatible.code === "protocol"
      )
        return null;
      throw incompatible;
    }
  }
}

export function matchesReview(
  display: Snapshot | null,
  current: Snapshot,
  reviewed?: ReviewedContent,
) {
  if (
    !display ||
    display.generation !== current.generation ||
    display.revision !== current.revision ||
    display.offlineGrant?.id !== current.offlineGrant?.id
  )
    return false;
  return (
    !reviewed ||
    (reviewed.generation === current.generation &&
      reviewed.grantId === current.offlineGrant?.id &&
      current.tasks.find((row) => row.id === reviewed.itemId)?.version ===
        reviewed.itemVersion)
  );
}
