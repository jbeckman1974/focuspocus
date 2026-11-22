import { actorRequest, HttpError, readSession, type Snapshot } from "../api.ts";
import {
  observeSession,
  offlineLease,
  readOffline,
  revokeOffline,
  syncOfflineLease,
  updateOffline,
} from "../offline/store.ts";
import type { OfflineLease } from "../offline/storeTypes.ts";
import type { QueueEntry } from "../offline/queueTypes.ts";
import { cachedItem } from "./cachedItem.ts";
import { contentUrl, type Content } from "./transport.ts";

export async function contentLease(actor: number, snapshot: Snapshot) {
  const lease = await offlineLease(actor, snapshot.workspaceId);
  if (
    !lease ||
    lease.grantId !== snapshot.offlineGrant?.id ||
    lease.generation !== snapshot.generation
  )
    throw new Error("Offline access changed. Reopen the workspace.");
  return lease;
}

export async function readSavedContent(lease: OfflineLease, item: string) {
  return cachedItem(await readOffline<QueueEntry>(lease), item);
}

export async function openTrustedContent(
  lease: OfflineLease,
  itemId: string,
  signal: AbortSignal,
) {
  let current: Content & Pick<Snapshot, "generation" | "offlineGrant">;
  try {
    const session = await readSession(signal);
    await observeSession(session, lease.epoch);
    if (
      session.user?.id !== lease.actorId ||
      !session.workspaces.some((space) => space.id === lease.workspaceId)
    )
      throw new HttpError(401, "Account or workspace access changed.");
    current = await actorRequest<typeof current>(
      lease.actorId,
      contentUrl(lease.workspaceId, itemId),
      { signal },
    );
  } catch (error) {
    signal.throwIfAborted();
    const interrupted =
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "TimeoutError") ||
      (error instanceof HttpError && error.status >= 500);
    if (!interrupted) {
      if (error instanceof HttpError && error.status === 404) {
        await updateOffline<QueueEntry, void>(lease, (data) => {
          delete data.content[itemId];
        });
      }
      throw error;
    }
    return readSavedContent(lease, itemId);
  }
  signal.throwIfAborted();
  if (current.offlineGrant && current.offlineGrant.id !== lease.grantId) {
    await revokeOffline(lease);
    throw new Error("Workspace access changed. Reopen the workspace.");
  }
  if (
    !current.offlineGrant ||
    current.offlineGrant.protocol !== 1 ||
    current.generation !== lease.generation
  ) {
    const saved = await readOffline<QueueEntry>(lease);
    await syncOfflineLease(lease, {
      ...saved.confirmed,
      generation: current.generation,
      offlineGrant: current.offlineGrant,
    });
    throw new Error("Offline content changed. Reopen the workspace.");
  }
  return updateOffline<QueueEntry, ReturnType<typeof cachedItem>>(
    lease,
    (data) => {
      const stored = data.content[itemId];
      if (!stored || current.revision >= stored.revision) {
        const { revision, itemVersion, maxFileBytes, document, files } =
          current;
        data.content[itemId] = {
          revision,
          itemVersion,
          maxFileBytes,
          document,
          files,
        };
      }
      return cachedItem(data, itemId);
    },
  );
}
