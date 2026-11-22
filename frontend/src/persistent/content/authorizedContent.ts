import { actorRequest, HttpError, readSession, type Snapshot } from "../api.ts";
import {
  lockOfflineActor,
  revokeOffline,
  syncOfflineLease,
  type OfflineLease,
} from "../offline/store.ts";
import { contentUrl, type Content } from "./transport.ts";

export interface AuthorizedContent
  extends
    Content,
    Pick<Snapshot, "generation" | "offlineGrant" | "workspaceId"> {
  itemId: string;
}

export function requireContentTarget(
  data: AuthorizedContent,
  workspace: string,
  item: string,
) {
  if (data.workspaceId !== workspace || data.itemId !== item)
    throw new HttpError(
      409,
      "The response belongs to a different task. Reopen the workspace.",
    );
}

export async function authorizedContent(
  lease: OfflineLease,
  itemId: string,
  signal: AbortSignal,
) {
  const session = await readSession(signal);
  signal.throwIfAborted();
  // Only the account sign-in flow can establish a new device identity. An
  // item read is allowed to lock its own earlier epoch or revoke its own lease.
  if (session.user?.id !== lease.actorId) {
    await lockOfflineActor(lease.actorId, lease.epoch);
    throw new HttpError(401, "Account access changed.");
  }
  if (!session.workspaces.some((space) => space.id === lease.workspaceId)) {
    await revokeOffline(lease);
    throw new HttpError(403, "Workspace access changed.");
  }
  const current = await actorRequest<AuthorizedContent>(
    lease.actorId,
    contentUrl(lease.workspaceId, itemId),
    { signal },
  );
  signal.throwIfAborted();
  requireContentTarget(current, lease.workspaceId, itemId);
  // This transaction checks membership continuity, generation and device epoch.
  // Only a full workspace snapshot can extend an offline access deadline.
  await syncOfflineLease(lease, current, undefined, false);
  signal.throwIfAborted();
  return current;
}
