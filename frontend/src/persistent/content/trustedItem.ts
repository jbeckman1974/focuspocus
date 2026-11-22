import { HttpError, type Snapshot } from "../api.ts";
import { offlineLease, readOffline, updateOffline } from "../offline/store.ts";
import type { OfflineLease } from "../offline/storeTypes.ts";
import type { QueueEntry } from "../offline/queueTypes.ts";
import { cachedItem } from "./cachedItem.ts";
import {
  authorizedContent,
  type AuthorizedContent,
} from "./authorizedContent.ts";

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
  let current: AuthorizedContent;
  try {
    current = await authorizedContent(lease, itemId, signal);
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
