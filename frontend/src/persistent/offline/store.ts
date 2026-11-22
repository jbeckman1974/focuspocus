import type { Snapshot } from "../api.ts";
import type { WorkspaceInfo } from "../tools/WorkspaceRouter.tsx";
import { dataKey, transaction } from "./storeDatabase.ts";
import { notifyOffline } from "./storeEvents.ts";
import { checkBinding, checkLease, freshData, makeLease, OfflineAccessError, requireReadable, type Header, type OfflineData, type OfflineLease } from "./storeTypes.ts";

export * from "./storeTypes.ts";
export * from "./storeIdentity.ts";
export { offlineEvents } from "./storeEvents.ts";

function headerFor(snapshot: Snapshot, space: WorkspaceInfo): Header {
  const grant = snapshot.offlineGrant;
  if (!grant || grant.protocol !== 1) throw new OfflineAccessError("protocol");
  if (space.id !== snapshot.workspaceId || !grant.id || !snapshot.generation) throw new OfflineAccessError("revoked");
  const header = {space, grantId: grant.id, generation: snapshot.generation, protocol: grant.protocol,
    expiresAt: Date.parse(grant.expiresAt), pending: 0};
  requireReadable(header);
  return header;
}

export async function enableOffline(actor:{id:number;username:string},space:WorkspaceInfo,snapshot:Snapshot,epoch:string) {
  const header = headerFor(snapshot, space);
  const out = await transaction("readwrite",null,({profile,saveProfile,saveData}) => {
    checkBinding(profile,actor.id,epoch);
    const existing = profile.spaces[space.id];
    if (existing) {
      if (existing.grantId !== header.grantId || existing.space.role !== space.role) throw new OfflineAccessError("revoked");
      if (existing.generation !== header.generation) throw new OfflineAccessError("generation");
      requireReadable(existing);
      return makeLease(profile,existing);
    }
    profile.spaces[space.id] = header;
    profile.username = actor.username;
    profile.active = space.id;
    saveData(actor.id,space.id,freshData(snapshot));
    saveProfile();
    return makeLease(profile,header);
  });
  notifyOffline("workspace");
  return out;
}

export async function offlineLease(actor:number,workspace:string) {
  return transaction("readonly",null,({profile}) => {
    if (profile.actorId !== actor || !profile.authenticated || profile.logoutActor !== null) return null;
    const header = profile.spaces[workspace];
    return header ? makeLease(profile,header) : null;
  });
}

export async function readOffline<T>(lease:OfflineLease) {
  return transaction<T,OfflineData<T>>("readonly",dataKey(lease.actorId,lease.workspaceId),({profile,data}) => {
    requireReadable(checkLease(profile,lease));
    if (!data) throw new OfflineAccessError("locked");
    return data;
  });
}

export async function updateOffline<T,R>(lease:OfflineLease,edit:(data:OfflineData<T>)=>R) {
  const result = await transaction<T,R>("readwrite",dataKey(lease.actorId,lease.workspaceId),({profile,data,saveData,saveProfile}) => {
    const header = checkLease(profile,lease);
    requireReadable(header);
    if (!data) throw new OfflineAccessError("locked");
    const value = edit(data);
    if (data.confirmed.workspaceId !== lease.workspaceId || data.projection.workspaceId !== lease.workspaceId
      || data.confirmed.generation !== lease.generation || data.projection.generation !== lease.generation)
      throw new OfflineAccessError("generation");
    header.pending = data.queue.length;
    saveData(lease.actorId,lease.workspaceId,data);
    saveProfile();
    return value;
  });
  notifyOffline("data");
  return result;
}

export async function syncOfflineLease(lease:OfflineLease,snapshot:Snapshot,space?:WorkspaceInfo) {
  const outcome = await transaction("readwrite",null,({profile,saveProfile,dropData}) => {
    const header = checkLease(profile,lease);
    const grant = snapshot.offlineGrant;
    if (snapshot.workspaceId !== lease.workspaceId) throw new OfflineAccessError("revoked");
    if (!grant || grant.protocol !== 1) {
      header.fence = "protocol"; saveProfile();
      return "protocol" as const;
    }
    if (grant.id !== header.grantId || (space && (space.role !== header.space.role || space.id !== lease.workspaceId))) {
      delete profile.spaces[lease.workspaceId];
      if (profile.active === lease.workspaceId) profile.active = null;
      dropData(lease.actorId,lease.workspaceId); saveProfile();
      return "revoked" as const;
    }
    if (snapshot.generation !== header.generation) {
      header.fence = "generation"; saveProfile();
      return "generation" as const;
    }
    const next = headerFor(snapshot,space ?? header.space);
    // A fresh read of a compatible schema can lift a temporary protocol fence.
    Object.assign(header,next,{pending:header.pending,fence:undefined});
    saveProfile();
    return makeLease(profile,header);
  });
  if (typeof outcome === "string") { notifyOffline("workspace"); throw new OfflineAccessError(outcome); }
  return outcome;
}

export async function revokeOffline(lease:OfflineLease) {
  await transaction("readwrite",null,({profile,saveProfile,dropData}) => {
    checkLease(profile,lease);
    delete profile.spaces[lease.workspaceId];
    if (profile.active === lease.workspaceId) profile.active = null;
    dropData(lease.actorId,lease.workspaceId);
    saveProfile();
  });
  notifyOffline("workspace");
}

function reviewHeader(header:Header,lease:OfflineLease,snapshot:Snapshot) {
  const grant = snapshot.offlineGrant;
  if (snapshot.workspaceId !== lease.workspaceId || !grant || grant.id !== header.grantId)
    throw new OfflineAccessError("revoked");
  const next = headerFor(snapshot,header.space);
  return next;
}

export async function readOfflineForReview<T>(lease:OfflineLease,current:Snapshot) {
  return transaction<T,OfflineData<T>>("readonly",dataKey(lease.actorId,lease.workspaceId),({profile,data}) => {
    reviewHeader(checkLease(profile,lease),lease,current);
    if (!data) throw new OfflineAccessError("locked");
    return data;
  });
}

export async function rebindOffline<T,R>(lease:OfflineLease,current:Snapshot,edit:(old:OfflineData<T>,next:OfflineData<T>)=>R) {
  const nextLease = await transaction<T,OfflineLease>("readwrite",dataKey(lease.actorId,lease.workspaceId),({profile,data,saveData,saveProfile}) => {
    const nextHeader = reviewHeader(checkLease(profile,lease),lease,current);
    if (!data) throw new OfflineAccessError("locked");
    const next = freshData<T>(current);
    const value = edit(data,next);
    if (value instanceof Promise) throw new Error("Reconciliation requires a synchronous update.");
    nextHeader.pending = next.queue.length;
    profile.spaces[lease.workspaceId] = nextHeader;
    saveData(lease.actorId,lease.workspaceId,next);
    saveProfile();
    return makeLease(profile,nextHeader);
  });
  notifyOffline("workspace");
  return nextLease;
}
