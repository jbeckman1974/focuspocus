import type { Snapshot } from "../api.ts";
import type { QueueEntry } from "../offline/queueTypes.ts";
import type { OfflineData } from "../offline/storeTypes.ts";
import { attachmentLimit } from "./fileLimit.ts";
import { emptyNote } from "./document.ts";
import type { Content } from "./transport.ts";

type ItemQueueEntry = Pick<QueueEntry, "id" | "content" | "state" | "reason">;

export function cachedItem(
  data: Pick<
    OfflineData<ItemQueueEntry>,
    "confirmed" | "projection" | "content" | "queue"
  >,
  itemId: string,
) {
  const item = (snapshot: Snapshot) =>
    snapshot.tasks.find((task) => task.id === itemId);
  const visible = item(data.projection);
  if (!visible)
    throw new Error("This task is unavailable in the saved workspace.");
  const stored = data.content[itemId];
  const pending = data.queue.filter(
    (entry) => entry.content?.itemId === itemId,
  );
  const pendingNotes = pending.flatMap((entry) =>
    entry.content?.action === "save" ? [entry.content.document] : [],
  );
  // A newly captured local task starts empty. An existing unopened task can
  // receive a file without replacing a note whose contents we have never read.
  const known = Boolean(stored) || !item(data.confirmed);
  // The server validates its current per-file and workspace-wide limits again.
  const maxFileBytes = attachmentLimit(
    data.confirmed.maxFileBytes,
    stored?.maxFileBytes,
  );
  const base: Content = stored
    ? { ...stored, maxFileBytes }
    : {
        revision: data.confirmed.revision,
        itemVersion: visible.version,
        document: emptyNote,
        files: [],
        maxFileBytes,
      };
  return { base, known, draft: pendingNotes.at(-1) ?? base.document, pending };
}
