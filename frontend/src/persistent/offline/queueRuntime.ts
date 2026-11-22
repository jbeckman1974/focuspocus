import {
  HttpError,
  type Receipt,
  type Snapshot,
  type WorkspaceApi,
} from "../api.ts";
import type { OfflineContent } from "../content/offlineContent.ts";
import type { Write } from "../writes.ts";
import {
  acknowledge,
  enqueue,
  markConflict,
  nextTransmission,
  queueNotices,
  resolveEntry,
  type QueueData,
} from "./queue.ts";
import { projectQueue } from "./queueProjection.ts";
import type { QueueEntry, QueueNotice } from "./queueTypes.ts";
import {
  offlineEvents,
  discardIncompatibleEntry,
  lockOfflineActor,
  reviewIncompatible,
  OfflineAccessError,
  readOffline,
  rebindOffline,
  revokeOffline,
  syncOfflineLease,
  updateOffline,
  type OfflineLease,
} from "./store.ts";

interface Observer {
  view(
    snapshot: Snapshot | null,
    queue: QueueNotice[],
    offline: boolean,
    message: string,
    reviewOnly?: boolean,
  ): void;
  saved(entry: QueueEntry, receipt: Receipt): void;
  lost(status?: number): void;
}

export class OfflineQueue {
  private active = true;
  private syncing = false;
  private offline = false;
  private loaded = false;
  private reviewOnly = false;
  private needsSnapshot = true;
  private unsubscribe: () => void;
  private displayEpoch = 0;
  private api: WorkspaceApi;
  private lease: OfflineLease;
  private observer: Observer;
  constructor(api: WorkspaceApi, lease: OfflineLease, observer: Observer) {
    this.api = api;
    this.lease = lease;
    this.observer = observer;
    this.unsubscribe = offlineEvents((kind, remote) => {
      if (remote || kind !== "data") void this.readLocal();
    });
  }
  stop() {
    this.active = false;
    this.unsubscribe();
    this.displayEpoch++;
  }
  private show(doc: QueueData, message?: string) {
    if (!this.active) return;
    this.loaded = true;
    this.observer.view(
      doc.projection,
      queueNotices(doc),
      this.offline,
      message ??
        (doc.queue.length
          ? doc.queue.length +
            " local change" +
            (doc.queue.length === 1 ? "" : "s") +
            " pending."
          : this.offline
            ? "Offline. This workspace is saved on this device."
            : "Saved changes"),
    );
  }
  private async readLocal() {
    const order = ++this.displayEpoch;
    try {
      const data = await readOffline<QueueEntry>(this.lease);
      if (this.active && order === this.displayEpoch) this.show(data);
      return data;
    } catch (error) {
      if (this.active && order === this.displayEpoch) {
        this.observer.view(
          null,
          [],
          false,
          error instanceof Error
            ? error.message
            : "Unable to open device storage.",
        );
        if (
          error instanceof OfflineAccessError &&
          ["locked", "revoked"].includes(error.code)
        )
          this.observer.lost();
      }
      return null;
    }
  }
  async stage(
    write: Write,
    base: Snapshot,
    content?: OfflineContent,
    bytes?: Blob | null,
  ) {
    if (!this.active) throw new Error("The workspace was closed.");
    const doc = await updateOffline<QueueEntry, QueueData>(
      this.lease,
      (doc) => {
        enqueue(doc, base, write, content, bytes);
        return doc;
      },
    );
    this.show(doc);
    void this.tick(true);
  }
  async resolve(id: string, action: "reapply" | "discard") {
    if (!this.active) return;
    if (this.reviewOnly && action === "discard") {
      const current = await this.api.snapshot();
      if (!this.active) return;
      if (current.offlineGrant?.protocol !== 1) {
        await discardIncompatibleEntry(this.lease, current, id);
        await this.showReview(current);
        return;
      }
      if (!(await this.syncLease(current))) return;
    }
    if (action === "reapply") {
      const allowed = await this.api.verifySession();
      if (!allowed) throw new Error("Current write permission is required.");
      const snapshot = await this.api.snapshot();
      if (!this.active) return;
      if (!(await this.syncLease(snapshot)))
        throw new Error(
          "Open this draft in a compatible workspace before reapplying.",
        );
      await updateOffline<QueueEntry, void>(this.lease, (doc) => {
        if (snapshot.revision < doc.confirmed.revision)
          throw new Error("The workspace changed. Review again.");
        doc.confirmed = snapshot;
        resolveEntry(doc, id, action);
      });
    } else
      await updateOffline<QueueEntry, void>(this.lease, (doc) =>
        resolveEntry(doc, id, action),
      );
    await this.readLocal();
    void this.tick(true);
  }
  private async showReview(snapshot: Snapshot) {
    const rows = await reviewIncompatible(this.lease, snapshot);
    if (!this.active) return;
    this.reviewOnly = true;
    this.observer.view(
      null,
      rows.map((row) => ({
        ...row,
        status: "conflict" as const,
        reason: "This draft uses an incompatible offline format.",
        base: "",
        draft: row.description,
        current: "",
      })),
      false,
      "The offline format changed. A compatible app is required to reapply drafts.",
      true,
    );
  }
  private async syncLease(current: Snapshot) {
    try {
      this.lease = await syncOfflineLease(this.lease, current);
    } catch (error) {
      if (
        error instanceof OfflineAccessError &&
        error.code === "protocol" &&
        current.offlineGrant?.protocol !== 1
      ) {
        await this.showReview(current);
        return false;
      }
      if (
        !(error instanceof OfflineAccessError) ||
        !["generation", "protocol"].includes(error.code) ||
        current.offlineGrant?.protocol !== 1
      )
        throw error;
      this.lease = await rebindOffline<QueueEntry, void>(
        this.lease,
        current,
        (old, next) => {
          if (
            old.queue.some(
              (entry) => entry.protocol !== 1 || !entry.write?.envelope,
            )
          )
            throw new OfflineAccessError("protocol");
          next.queue = old.queue;
          for (const entry of next.queue) {
            markConflict(
              entry,
              error.code === "generation"
                ? "Database restored. Compare this draft with the new workspace before reapplying."
                : "Offline format changed. Compare this draft with the current workspace before reapplying.",
            );
            if (old.files[entry.id]) next.files[entry.id] = old.files[entry.id];
          }
        },
      );
    }
    this.reviewOnly = false;
    return true;
  }
  private async observedSnapshot(base: QueueData | null, force: boolean) {
    if (
      !force &&
      base &&
      !base.queue.length &&
      !this.offline &&
      !this.needsSnapshot
    ) {
      try {
        const page = await this.api.changes(base.confirmed.cursor);
        if (
          !page.changes.length &&
          page.revision === base.confirmed.revision &&
          (page.perspectiveVersion === undefined ||
            page.perspectiveVersion === base.confirmed.perspectiveVersion) &&
          (page.resolvedCleanup === undefined ||
            page.resolvedCleanup === base.confirmed.resolvedCleanup)
        )
          return null;
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 410)) throw error;
      }
    }
    return this.api.snapshot();
  }
  async tick(force = false) {
    if (force) this.needsSnapshot = true;
    if (!this.active || this.syncing) return;
    this.syncing = true;
    try {
      const base = this.reviewOnly ? null : await this.readLocal();
      if (!this.active) return;
      const current = await this.observedSnapshot(base, force);
      if (!this.active || !current) return;
      this.offline = false;
      this.needsSnapshot = false;
      if (!(await this.syncLease(current))) return;
      await this.drain(current);
    } catch (error) {
      if (!this.active) return;
      if (
        error instanceof HttpError &&
        [401, 403, 404].includes(error.status)
      ) {
        if (error.status === 401) {
          // Persist the denial before re-entering the account screen. A subsequent
          // transport failure cannot turn this expired session into an offline boot.
          await lockOfflineActor(this.lease.actorId, this.lease.epoch);
        } else await revokeOffline(this.lease).catch(() => {});
        this.observer.view(
          null,
          [],
          false,
          "Workspace access must be verified.",
        );
        this.observer.lost(error.status);
      } else if (error instanceof OfflineAccessError) {
        this.observer.view(null, [], false, error.message);
        if (error.code === "revoked" || error.code === "locked")
          this.observer.lost();
      } else {
        this.offline = true;
        const doc = await this.readLocal();
        if (!doc && !this.loaded && this.active)
          this.observer.view(null, [], true, "Connect to open this workspace.");
      }
    } finally {
      this.syncing = false;
    }
  }
  private async drain(first: Snapshot) {
    let current = first;
    // A short batch bounds one tick and allows other tabs and workspaces to progress.
    for (let i = 0; this.active && i < 20; i++) {
      const selected = await updateOffline<
        QueueEntry,
        { doc: QueueData; entry?: QueueEntry }
      >(this.lease, (doc) => {
        if (current.revision < doc.confirmed.revision) return { doc };
        return { entry: nextTransmission(doc, current), doc };
      });
      this.show(selected.doc);
      const entry = selected.entry;
      if (!this.active || !entry) return;
      // Reauthorize even when the queued transmission may already have a receipt.
      if (!(await this.api.verifySession()))
        throw new HttpError(403, "Write permission changed.");
      if (!this.active) return;
      try {
        let receipt: Receipt;
        if (entry.content) {
          if (!this.api.submitContent)
            throw new Error("Content transport unavailable.");
          receipt = await this.api.submitContent(
            entry.content,
            selected.doc.files[entry.id] ?? null,
            entry.write.envelope,
          );
        } else
          receipt = await this.api.submit(
            entry.write.name,
            entry.write.envelope,
          );
        // Keep the original sent envelope until a confirmed snapshot covers
        // the receipt. A crash anywhere above will retry the identical request.
        current = await this.api.snapshot();
        if (!this.active) return;
        if (!(await this.syncLease(current))) return;
        if (
          receipt.revision > current.revision ||
          entry.generation !== current.generation
        )
          return;
        const applied = await updateOffline<QueueEntry, boolean>(
          this.lease,
          (doc) => {
            if (!doc.queue.some((e) => e.id === entry.id)) return false;
            acknowledge(doc, entry, receipt);
            if (current.revision >= doc.confirmed.revision)
              doc.confirmed = current;
            doc.projection = projectQueue(doc.confirmed, doc.queue);
            return true;
          },
        );
        if (applied && this.active) this.observer.saved(entry, receipt);
      } catch (error) {
        if (!this.active) return;
        if (
          !(error instanceof HttpError) ||
          error.status >= 500 ||
          [401, 408, 429].includes(error.status)
        )
          throw error;
        // A missing target or stale anti-CSRF token can also report access
        // errors. Distinguish loss of this workspace before retaining a draft.
        if (!(await this.api.verifySession()))
          throw new HttpError(403, "Write permission changed.");
        current = await this.api.snapshot();
        if (!(await this.syncLease(current))) return;
        await updateOffline<QueueEntry, void>(this.lease, (doc) => {
          const pending = doc.queue.find((e) => e.id === entry.id);
          if (pending) markConflict(pending, error.message);
        });
      }
    }
    await this.readLocal();
  }
}
