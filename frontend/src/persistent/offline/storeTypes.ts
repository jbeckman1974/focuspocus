import type { Snapshot, Receipt } from "../api.ts";
import type { Content } from "../content/transport.ts";
import type { WorkspaceInfo } from "../tools/WorkspaceRouter.tsx";

export interface OfflineLease {
  epoch: string;
  actorId: number;
  workspaceId: string;
  grantId: string;
  generation: string;
}

export interface OfflineData<T> {
  confirmed: Snapshot;
  projection: Snapshot;
  queue: T[];
  receipts: Record<string, Receipt>;
  files: Record<string, Blob>;
  content: Record<string, Content>;
}

export interface Header {
  space: WorkspaceInfo;
  grantId: string;
  generation: string;
  protocol: number;
  expiresAt: number;
  pending: number;
  fence?: "generation" | "protocol";
}

export interface Profile {
  epoch: string;
  actorId: number | null;
  username: string;
  authenticated: boolean;
  active: string | null;
  logoutActor: number | null;
  spaces: Record<string, Header>;
}

export interface OfflineBoot {
  actor: { id: number; username: string };
  space: WorkspaceInfo;
  lease: OfflineLease;
  expiresAt: number;
}

export type AccessCode = "expired" | "revoked" | "generation" | "protocol" | "locked";

export class OfflineAccessError extends Error {
  readonly code: AccessCode;
  constructor(code: AccessCode) {
    super({
      expired: "Offline access expired. Connect and sign in again.",
      revoked: "Offline access to this workspace changed.",
      generation: "The server data was restored. Review your offline changes.",
      protocol: "The offline format changed. Review your offline changes.",
      locked: "Offline data is locked for this account.",
    }[code]);
    this.code = code;
  }
}

export const freshProfile = (): Profile => ({
  epoch: crypto.randomUUID(),
  actorId: null,
  username: "",
  authenticated: false,
  active: null,
  logoutActor: null,
  spaces: {},
});

export function checkBinding(profile: Profile, actor: number, epoch: string) {
  if (profile.epoch !== epoch || profile.actorId !== actor || !profile.authenticated || profile.logoutActor !== null)
    throw new OfflineAccessError("locked");
}

export function checkLease(profile: Profile, lease: OfflineLease): Header {
  checkBinding(profile, lease.actorId, lease.epoch);
  const row = Object.hasOwn(profile.spaces, lease.workspaceId) ? profile.spaces[lease.workspaceId] : undefined;
  if (!row || row.grantId !== lease.grantId) throw new OfflineAccessError("revoked");
  if (row.generation !== lease.generation) throw new OfflineAccessError("generation");
  return row;
}

export function requireReadable(header: Header, now = Date.now()) {
  if (header.fence) throw new OfflineAccessError(header.fence);
  if (header.protocol !== 1) throw new OfflineAccessError("protocol");
  if (header.expiresAt <= now || !Number.isFinite(header.expiresAt)) throw new OfflineAccessError("expired");
}

export function makeLease(profile: Profile, header: Header): OfflineLease {
  return { epoch: profile.epoch, actorId: profile.actorId!, workspaceId: header.space.id, grantId: header.grantId, generation: header.generation };
}

export function freshData<T>(snapshot: Snapshot): OfflineData<T> {
  return { confirmed: snapshot, projection: structuredClone(snapshot), queue: [], files: {}, receipts: {}, content: {} };
}
