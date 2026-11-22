import type { Snapshot } from "../api.ts";
import { dataKey, transaction } from "./storeDatabase.ts";
import { notifyOffline } from "./storeEvents.ts";
import {
  checkLease,
  freshData,
  headerFor,
  makeLease,
  OfflineAccessError,
  sameMembership,
  type Header,
  type OfflineData,
  type OfflineLease,
} from "./storeTypes.ts";

function reviewHeader(header: Header, lease: OfflineLease, snapshot: Snapshot) {
  if (
    snapshot.workspaceId !== lease.workspaceId ||
    !sameMembership(header, snapshot)
  )
    throw new OfflineAccessError("revoked");
  if (
    header.fence === "generation" &&
    header.nextGeneration !== snapshot.generation
  )
    throw new OfflineAccessError("generation");
  const next = headerFor(snapshot, header.space);
  return next;
}

export async function readOfflineForReview<T>(
  lease: OfflineLease,
  current: Snapshot,
) {
  return transaction<T, OfflineData<T>>(
    "readonly",
    dataKey(lease.actorId, lease.workspaceId),
    ({ profile, data }) => {
      reviewHeader(checkLease(profile, lease), lease, current);
      if (!data) throw new OfflineAccessError("locked");
      return data;
    },
  );
}

export async function rebindOffline<T, R>(
  lease: OfflineLease,
  current: Snapshot,
  edit: (old: OfflineData<T>, next: OfflineData<T>) => R,
) {
  const nextLease = await transaction<T, OfflineLease>(
    "readwrite",
    dataKey(lease.actorId, lease.workspaceId),
    ({ profile, data, saveData, saveProfile }) => {
      const nextHeader = reviewHeader(
        checkLease(profile, lease),
        lease,
        current,
      );
      if (!data) throw new OfflineAccessError("locked");
      const next = freshData<T>(current);
      const value = edit(data, next);
      if (value instanceof Promise)
        throw new Error("Reconciliation requires a synchronous update.");
      nextHeader.pending = next.queue.length;
      profile.spaces[lease.workspaceId] = nextHeader;
      saveData(lease.actorId, lease.workspaceId, next);
      saveProfile();
      return makeLease(profile, nextHeader);
    },
  );
  notifyOffline("workspace");
  return nextLease;
}

interface HeldOperation {
  id: string;
  description: string;
}

function requireHeldReview(
  header: Header,
  lease: OfflineLease,
  current: Snapshot,
) {
  if (!header.fence) throw new OfflineAccessError("locked");
  if (
    current.workspaceId !== lease.workspaceId ||
    !sameMembership(header, current)
  )
    throw new OfflineAccessError("revoked");
  const expiry = Date.parse(current.offlineGrant!.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now())
    throw new OfflineAccessError("expired");
}

export function reviewIncompatible(
  lease: OfflineLease,
  current: Snapshot,
): Promise<HeldOperation[]> {
  return transaction<HeldOperation, HeldOperation[]>(
    "readonly",
    dataKey(lease.actorId, lease.workspaceId),
    ({ profile, data }) => {
      requireHeldReview(checkLease(profile, lease), lease, current);
      if (!data) throw new OfflineAccessError("locked");
      return data.queue
        .filter((row) => typeof row?.id === "string")
        .map((row) => ({
          id: row.id,
          description:
            typeof row.description === "string"
              ? row.description.slice(0, 400)
              : "Pending change",
        }));
    },
  );
}

export async function discardIncompatibleEntry(
  lease: OfflineLease,
  current: Snapshot,
  id: string,
) {
  await transaction<HeldOperation, void>(
    "readwrite",
    dataKey(lease.actorId, lease.workspaceId),
    ({ profile, data, saveData, saveProfile }) => {
      const header = checkLease(profile, lease);
      requireHeldReview(header, lease, current);
      if (!data) throw new OfflineAccessError("locked");
      data.queue = data.queue.filter((row) => row?.id !== id);
      delete data.files[id];
      header.pending = data.queue.length;
      saveData(lease.actorId, lease.workspaceId, data);
      saveProfile();
    },
  );
  notifyOffline("data");
}

export async function fenceOfflineFormat(lease: OfflineLease) {
  const changed = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile }) => {
      const header = checkLease(profile, lease);
      if (header.fence) return false;
      header.fence = "protocol";
      saveProfile();
      return true;
    },
  );
  if (changed) notifyOffline("workspace");
}
