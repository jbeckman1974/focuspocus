import type { WorkspaceInfo } from "../tools/WorkspaceRouter.tsx";
import { pendingPurge, reauthFence } from "./storeLock.ts";
import { dataKey, transaction } from "./storeDatabase.ts";
import { notifyOffline } from "./storeEvents.ts";
import {
  checkLease,
  headerFor,
  makeLease,
  OfflineAccessError,
  requireReadable,
  sameMembership,
  type GrantSnapshot,
  type OfflineData,
  type OfflineLease,
} from "./storeTypes.ts";
export * from "./storeTypes.ts";
export * from "./storeIdentity.ts";
export {
  pruneOfflineDirectory,
  markOfflineActive,
  forgetOfflineWorkspace,
} from "./storeDirectory.ts";
export * from "./storeEnrollment.ts";
export * from "./storeReview.ts";
export { offlineEvents } from "./storeEvents.ts";

export async function offlineLease(actor: number, workspace: string) {
  return transaction("readonly", null, ({ profile }) => {
    if (
      profile.actorId !== actor ||
      !profile.authenticated ||
      profile.logoutActor !== null ||
      pendingPurge(actor) !== null ||
      reauthFence(profile.epoch) !== null
    )
      return null;
    const header = profile.spaces[workspace];
    return header ? makeLease(profile, header) : null;
  });
}

export async function readOffline<T>(lease: OfflineLease) {
  return transaction<T, OfflineData<T>>(
    "readonly",
    dataKey(lease.actorId, lease.workspaceId),
    ({ profile, data }) => {
      requireReadable(checkLease(profile, lease));
      if (!data) throw new OfflineAccessError("locked");
      return data;
    },
  );
}

export async function updateOffline<T, R>(
  lease: OfflineLease,
  edit: (data: OfflineData<T>) => R,
) {
  const result = await transaction<T, R>(
    "readwrite",
    dataKey(lease.actorId, lease.workspaceId),
    ({ profile, data, saveData, saveProfile }) => {
      const header = checkLease(profile, lease);
      requireReadable(header);
      if (!data) throw new OfflineAccessError("locked");
      const value = edit(data);
      if (
        data.confirmed.workspaceId !== lease.workspaceId ||
        data.projection.workspaceId !== lease.workspaceId ||
        data.confirmed.generation !== lease.generation ||
        data.projection.generation !== lease.generation
      )
        throw new OfflineAccessError("generation");
      header.pending = data.queue.length;
      saveData(lease.actorId, lease.workspaceId, data);
      saveProfile();
      return value;
    },
  );
  notifyOffline("data");
  return result;
}

export async function syncOfflineLease(
  lease: OfflineLease,
  snapshot: GrantSnapshot,
  space?: WorkspaceInfo,
  renew = true,
) {
  const outcome = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile, dropData }) => {
      const header = checkLease(profile, lease);
      const grant = snapshot.offlineGrant;
      if (snapshot.workspaceId !== lease.workspaceId)
        throw new OfflineAccessError("revoked");
      if (
        (grant?.id && !sameMembership(header, snapshot)) ||
        (space &&
          (space.role !== header.space.role || space.id !== lease.workspaceId))
      ) {
        delete profile.spaces[lease.workspaceId];
        if (profile.active === lease.workspaceId) profile.active = null;
        dropData(lease.actorId, lease.workspaceId);
        saveProfile();
        return "revoked" as const;
      }
      if (!grant || grant.protocol !== 1) {
        header.fence = "protocol";
        saveProfile();
        return "protocol" as const;
      }
      if (snapshot.generation !== header.generation) {
        header.fence = "generation";
        header.nextGeneration = snapshot.generation;
        saveProfile();
        return "generation" as const;
      }
      if (header.fence) return header.fence;
      const next = headerFor(snapshot, space ?? header.space);
      if (!renew) {
        requireReadable(header);
        return makeLease(profile, header);
      }
      Object.assign(header, next, {
        pending: header.pending,
        fence: undefined,
      });
      saveProfile();
      return makeLease(profile, header);
    },
  );
  if (typeof outcome === "string") {
    notifyOffline("workspace");
    throw new OfflineAccessError(outcome);
  }
  return outcome;
}

export async function revokeOffline(lease: OfflineLease) {
  await transaction("readwrite", null, ({ profile, saveProfile, dropData }) => {
    checkLease(profile, lease);
    delete profile.spaces[lease.workspaceId];
    if (profile.active === lease.workspaceId) profile.active = null;
    dropData(lease.actorId, lease.workspaceId);
    saveProfile();
  });
  notifyOffline("workspace");
}
