import type { Receipt, Snapshot } from "../api.ts";
import type { OfflineContent } from "../content/offlineContent.ts";
import { describeDraft, type Write } from "../writes.ts";
import {
  changedResources,
  comparison,
  prerequisites,
  writeScopes,
} from "./queueGuards.ts";
import { project, projectQueue } from "./queueProjection.ts";
import type { OfflineData } from "./store.ts";
import { rows, type QueueEntry, type QueueNotice } from "./queueTypes.ts";

export type QueueData = OfflineData<QueueEntry>;

export function enqueue(
  doc: QueueData,
  base: Snapshot,
  write: Write,
  content?: OfflineContent,
  bytes?: Blob | null,
) {
  const grant = base.offlineGrant;
  if (
    !grant ||
    grant.protocol !== 1 ||
    !(Date.parse(grant.expiresAt) > Date.now()) ||
    base.workspaceId !== doc.confirmed.workspaceId ||
    grant.id !== doc.confirmed.offlineGrant?.id ||
    base.generation !== doc.confirmed.generation
  ) {
    throw new Error(
      "Open an authorized workspace online before saving offline.",
    );
  }
  if (content?.action === "upload" && (!bytes || bytes.size !== content.size))
    throw new Error(
      "The complete attachment is required before saving offline.",
    );
  const keys = writeScopes(write, base, content?.itemId);
  const protectedKeys =
    write.name === "capture" || write.name === "create-container"
      ? keys.filter((key) => !key.startsWith("list:"))
      : keys;
  const { guards, dependencies } = prerequisites(
    base,
    protectedKeys,
    doc.queue,
  );
  if (content) {
    const item = guards.find((g) => g.key === "row:" + content.itemId);
    if (item && !item.predecessors.length)
      item.value = String(content.itemVersion);
  }
  const id = write.envelope.operationId;
  const entry: QueueEntry = {
    id,
    protocol: 1,
    write,
    content,
    grant: grant.id,
    generation: base.generation,
    expiresAt: grant.expiresAt,
    guards,
    affects: keys,
    dependencies,
    description: content
      ? content.action === "upload"
        ? "Upload " + content.name
        : content.action === "save"
          ? "Save note"
          : "Remove attachment"
      : describeDraft(write.intent, base),
    before: comparison(base, keys),
    state: "queued",
    reason: "",
    transmitted: false,
  };
  if (!content) project(doc.projection, write); // Validate the local edit before claiming it is durable.
  if (bytes) doc.files[id] = bytes;
  doc.queue.push(entry);
  doc.projection = projectQueue(doc.confirmed, doc.queue);
}

export function queueNotices(doc: QueueData): QueueNotice[] {
  const unresolved = new Set(
    doc.queue.filter((e) => e.state === "conflict").map((e) => e.id),
  );
  return doc.queue.map((entry) => {
    const blocked = entry.dependencies.some(
      (id) =>
        unresolved.has(id) ||
        (!doc.receipts[id] && !doc.queue.some((e) => e.id === id)),
    );
    if (blocked) unresolved.add(entry.id);
    return {
      id: entry.id,
      description: entry.description,
      status: blocked ? "blocked" : entry.state,
      reason:
        entry.reason ||
        (blocked ? "Resolve the earlier related edit first." : ""),
      base: entry.before,
      draft: entry.description,
      current: comparison(doc.confirmed, entry.affects),
      content: entry.content,
    };
  });
}

export function nextTransmission(doc: QueueData, current: Snapshot) {
  doc.confirmed = current;
  for (const entry of doc.queue) {
    if (
      entry.state === "conflict" ||
      entry.dependencies.some((id) => !doc.receipts[id])
    )
      continue;
    if (
      entry.protocol !== 1 ||
      entry.grant !== current.offlineGrant?.id ||
      current.offlineGrant.protocol !== 1 ||
      entry.generation !== current.generation ||
      !(Date.parse(entry.expiresAt) > Date.now())
    ) {
      markConflict(
        entry,
        "The signed edit context, server generation or offline format changed. Compare the draft before reapplying.",
      );
      continue;
    }
    if (!entry.transmitted) {
      if (changedResources(entry.guards, current, doc.receipts).length) {
        markConflict(
          entry,
          "A referenced item, destination or order changed. Compare the draft with the current workspace.",
        );
        continue;
      }
      entry.write.envelope.expectedRevision = current.revision;
      if (entry.content) {
        const item = rows(current).find(
          (row) => row.id === entry.content!.itemId,
        );
        if (!item) {
          markConflict(entry, "The attachment or note target was removed.");
          continue;
        }
        entry.content = { ...entry.content, itemVersion: item.version };
      }
      entry.transmitted = true;
    }
    entry.state = "sent";
    doc.projection = projectQueue(current, doc.queue);
    return entry;
  }
  doc.projection = projectQueue(current, doc.queue);
  return undefined;
}

export function markConflict(entry: QueueEntry, reason: string) {
  entry.state = "conflict";
  entry.reason = reason;
}

export function acknowledge(
  doc: QueueData,
  entry: QueueEntry,
  receipt: Receipt,
) {
  if (
    receipt.operationId !== entry.id ||
    !Number.isSafeInteger(receipt.revision)
  ) {
    throw new Error("The saved response could not be matched to this draft.");
  }
  doc.receipts[entry.id] = receipt;
  doc.queue = doc.queue.filter((e) => e.id !== entry.id);
  delete doc.files[entry.id];
  // Only pending causal references need receipts across a browser restart.
  for (const id of Object.keys(doc.receipts)) {
    if (!doc.queue.some((e) => e.dependencies.includes(id)))
      delete doc.receipts[id];
  }
}

export function resolveEntry(
  doc: QueueData,
  id: string,
  decision: "reapply" | "discard",
) {
  const index = doc.queue.findIndex((entry) => entry.id === id);
  const entry = doc.queue[index];
  if (!entry) return;
  if (entry.state === "sent")
    throw new Error(
      "Reconnect to learn whether the transmitted edit was saved.",
    );
  if (decision === "discard") {
    doc.queue.splice(index, 1);
    delete doc.files[id];
  } else {
    if (
      entry.state !== "conflict" &&
      !queueNotices(doc).some(
        (notice) => notice.id === id && notice.status === "blocked",
      )
    )
      return;
    const current = doc.confirmed;
    const freshId = crypto.randomUUID();
    const write: Write = {
      ...entry.write,
      envelope: {
        ...entry.write.envelope,
        operationId: freshId,
        context: current.context,
        expectedRevision: current.revision,
      },
    };
    // Reapply to the reviewed server values. Preserve generated item and file
    // identities. A colliding capture or a disappeared destination still fails.
    if (
      entry.content &&
      !rows(current).some((row) => row.id === entry.content!.itemId)
    )
      throw new Error("The content target no longer exists.");
    if (!entry.content) project(current, write);
    const scope = writeScopes(write, current, entry.content?.itemId);
    const earlier = doc.queue.slice(0, index);
    const { dependencies, guards } = prerequisites(current, scope, earlier);
    doc.queue[index] = {
      ...entry,
      id: freshId,
      write,
      transmitted: false,
      state: "queued",
      reason: "",
      affects: scope,
      guards,
      dependencies,
      generation: current.generation,
      grant: current.offlineGrant!.id,
      expiresAt: current.offlineGrant!.expiresAt,
      before: comparison(current, scope),
    };
    if (doc.files[id]) {
      doc.files[freshId] = doc.files[id];
      delete doc.files[id];
    }
    for (const dependent of doc.queue.slice(index + 1)) {
      dependent.dependencies = dependent.dependencies.map((old) =>
        old === id ? freshId : old,
      );
      for (const guard of dependent.guards)
        guard.predecessors = guard.predecessors.map((old) =>
          old === id ? freshId : old,
        );
    }
  }
  doc.projection = projectQueue(doc.confirmed, doc.queue);
}
