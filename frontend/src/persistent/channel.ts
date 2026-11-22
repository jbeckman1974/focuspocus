import { OfflineQueue } from "./offline/queueRuntime.ts";
import type { QueueNotice } from "./offline/queueTypes.ts";
import type { OfflineLease } from "./offline/store.ts";
import type { StageContent } from "./content/offlineContent.ts";
import type { RepeatPreviewRequest } from "./repeat.ts";
import { CommandHistory } from "./history.ts";
import { HttpError } from "./api.ts";
import type { Receipt, Snapshot, WorkspaceApi } from "./api.ts";
import { prepare } from "./writes.ts";
import type { Intent, Write } from "./writes.ts";

type Phase =
  | "loading"
  | "ready"
  | "sending"
  | "uncertain"
  | "acknowledged"
  | "conflict"
  | "rejected"
  | "verifying"
  | "retryable";
export interface ChannelState {
  snapshot: Snapshot | null;
  queue: QueueNotice[];
  reviewOnly: boolean;
  offline: boolean;
  lastStaged: {
    operationId: string;
    selection: string[];
    intent: Intent;
  } | null;
  phase: Phase;
  pending: Write | null;
  undo: Receipt | null;
  redo: Receipt | null;
  message: string;
  conflictFresh: boolean;
  lastChange: { receipt: Receipt; intent: Intent } | null;
}

export class WorkspaceChannel {
  private api: WorkspaceApi;
  private durable?: OfflineQueue;
  private staging = false;
  private history = new CommandHistory();
  private lostAccess: (status?: number) => void;
  private listeners = new Set<() => void>();
  private active = true;
  private polling = false;
  private requestedSnapshot = 0;
  private finishedSnapshot = 0;
  private epoch = 0;
  private accessCheck: { write: Write; status: number; reason: string } | null =
    null;
  private state: ChannelState = {
    snapshot: null,
    queue: [],
    reviewOnly: false,
    offline: false,
    lastStaged: null,
    phase: "loading",
    pending: null,
    ...this.history.clear(),
    message: "",
    conflictFresh: false,
    lastChange: null,
  };

  constructor(
    api: WorkspaceApi,
    lostAccess: (status?: number) => void,
    lease?: OfflineLease | null,
  ) {
    this.api = api;
    this.lostAccess = lostAccess;
    if (lease)
      this.durable = new OfflineQueue(api, lease, {
        view: (snapshot, queue, offline, message, reviewOnly = false) =>
          this.update({
            snapshot,
            queue,
            reviewOnly,
            offline,
            message,
            phase: snapshot ? "ready" : "loading",
            ...(!snapshot
              ? {
                  ...this.history.clear(),
                  lastStaged: null,
                  lastChange: null,
                  pending: null,
                }
              : {}),
          }),
        saved: (entry, receipt) =>
          this.update({
            ...this.history.acknowledge(entry.write.name, receipt),
            lastChange: { receipt, intent: entry.write.intent },
          }),
        lost: (status) => {
          if (this.active) {
            this.stop();
            lostAccess(status);
          }
        },
      });
  }

  getSnapshot = () => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };

  stop() {
    this.active = false;
    this.durable?.stop();
    this.epoch++;
  }

  private update(next: Partial<ChannelState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => fn());
  }

  private accessError(error: unknown) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status)) {
      this.update({
        snapshot: null,
        pending: null,
        ...this.history.clear(),
        lastChange: null,
        phase: "loading",
      });
      this.accessCheck = null;
      this.stop();
      this.lostAccess(error.status);
      return true;
    }
    return false;
  }

  previewRepeat: RepeatPreviewRequest = async (
    id,
    rule,
    completedAt,
    signal,
  ) => {
    try {
      return await this.api.previewRepeat(id, rule, completedAt, signal);
    } catch (error) {
      if (error instanceof HttpError && [401, 403, 404].includes(error.status))
        await this.refresh();
      throw error;
    }
  };

  setViewZone = async (zone: string) => {
    this.api.setViewZone(zone);
    await this.refresh();
  };

  refresh = async () => {
    if (this.durable) return this.durable.tick(true);
    this.requestedSnapshot++;
    await this.tick();
  };

  tick = async () => {
    if (this.durable) return this.durable.tick();
    if (!this.active || this.polling || this.state.phase === "sending") return;
    const epoch = this.epoch;
    const request = this.requestedSnapshot;
    this.polling = true;
    try {
      const { snapshot, phase } = this.state;
      if (phase === "verifying" && this.accessCheck) {
        const { write, status, reason } = this.accessCheck;
        const canWrite = await this.api.verifySession();
        const next = await this.api.snapshot();
        if (!this.active || epoch !== this.epoch) return;
        this.accessCheck = null;
        const retryable = status === 403 && canWrite;
        this.update({
          snapshot: next,
          pending: write,
          phase: retryable ? "retryable" : "rejected",
          message: retryable
            ? "Your session was refreshed. Retry the original change."
            : reason,
        });
        return;
      }
      let refresh =
        request !== this.finishedSnapshot ||
        !snapshot ||
        phase === "acknowledged" ||
        (phase === "conflict" && !this.state.conflictFresh);
      if (!refresh && snapshot) {
        try {
          const page = await this.api.changes(snapshot.cursor);
          refresh =
            page.changes.length > 0 ||
            page.revision !== snapshot.revision ||
            (page.perspectiveVersion !== undefined &&
              page.perspectiveVersion !== snapshot.perspectiveVersion) ||
            (page.resolvedCleanup !== undefined &&
              page.resolvedCleanup !== snapshot.resolvedCleanup);
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 410))
            throw error;
          refresh = true;
        }
      }
      if (!refresh) {
        if (
          this.active &&
          epoch === this.epoch &&
          this.state.message === "Connection interrupted. Reconnecting…"
        )
          this.update({ message: "Connected." });
        return;
      }
      const next = await this.api.snapshot();
      if (!this.active || epoch !== this.epoch) return;
      if (
        phase === "acknowledged" &&
        snapshot?.generation === next.generation &&
        next.revision < (this.state.lastChange?.receipt.revision ?? 0)
      )
        return;
      if (request !== this.requestedSnapshot) return;
      this.finishedSnapshot = request;
      this.update({ snapshot: next, conflictFresh: phase === "conflict" });
      if (phase === "acknowledged") {
        const restored = next.generation !== snapshot?.generation;
        this.update({
          phase: "ready",
          pending: null,
          ...(restored ? { ...this.history.clear(), lastChange: null } : {}),
          message: restored
            ? "Workspace restored. Check your recent changes."
            : "Saved changes",
        });
      } else if (phase === "loading") {
        this.update({ phase: "ready", message: "" });
      } else if (snapshot?.generation !== next.generation) {
        this.update({
          ...this.history.clear(),
          message:
            "Workspace restored. Check the current values before making changes.",
        });
      }
    } catch (error) {
      if (!this.active || epoch !== this.epoch || this.accessError(error))
        return;
      if (this.state.phase === "ready" || this.state.phase === "loading") {
        this.update({ message: "Connection interrupted. Reconnecting…" });
      }
    } finally {
      this.polling = false;
    }
  };

  run(intent: Intent, base = this.state.snapshot): boolean {
    if (!this.active || !base || this.state.phase !== "ready") return false;
    if (this.durable) {
      if (this.staging) return false;
      void this.runDurable(intent, base);
      return true;
    }
    const write = prepare(intent, base);
    void this.send(write);
    return true;
  }

  runDurable = async (
    intent: Intent,
    base = this.state.snapshot,
  ): Promise<boolean> => {
    if (!this.durable) return this.run(intent, base);
    if (!this.active || !base || this.staging || this.state.phase !== "ready")
      return false;
    const write = prepare(intent, base);
    this.staging = true;
    try {
      await this.durable.stage(write, base);
      const { payload, operationId } = write.envelope;
      const selection = Array.isArray(payload.items)
        ? payload.items.map((v: { id: string }) => v.id)
        : typeof payload.id === "string"
          ? [payload.id]
          : Array.isArray(payload.ids)
            ? (payload.ids as string[])
            : [];
      this.update({ lastStaged: { operationId, selection, intent } });
      return true;
    } catch (error) {
      this.update({
        message:
          "Could not save this edit on the device. " +
          (error instanceof Error ? error.message : "Check device storage."),
      });
      return false;
    } finally {
      this.staging = false;
    }
  };

  stageContent: StageContent = async (content, bytes, base) => {
    if (!this.active || !this.durable || this.state.phase !== "ready")
      throw new Error(
        "Open this workspace on a trusted device before saving offline.",
      );
    const write = prepare(
      { type: "content", action: content.action, id: content.itemId },
      base,
    );
    await this.durable.stage(write, base, content, bytes);
  };

  resolveQueued = async (id: string, action: "reapply" | "discard") => {
    try {
      await this.durable?.resolve(id, action);
    } catch (error) {
      this.update({
        message:
          error instanceof Error
            ? error.message
            : "Unable to resolve this draft.",
      });
    }
  };

  retry() {
    if (
      ["uncertain", "retryable"].includes(this.state.phase) &&
      this.state.pending
    )
      void this.send(this.state.pending);
  }

  reapply() {
    if (
      this.state.phase !== "conflict" ||
      !this.state.conflictFresh ||
      !this.state.pending ||
      !this.state.snapshot
    )
      return;
    void this.send(prepare(this.state.pending.intent, this.state.snapshot));
  }

  discard() {
    if (!["conflict", "rejected", "retryable"].includes(this.state.phase))
      return;
    this.update({
      pending: null,
      phase: "ready",
      message: "Change discarded.",
    });
  }

  private async send(write: Write) {
    const epoch = ++this.epoch;
    this.update({
      phase: "sending",
      pending: write,
      message: "Saving…",
      conflictFresh: false,
    });
    try {
      const receipt = await this.api.submit(write.name, write.envelope);
      if (!this.active || epoch !== this.epoch) return;
      this.update({
        phase: "acknowledged",
        ...this.history.acknowledge(write.name, receipt),
        lastChange: { receipt, intent: write.intent },
        message: "Saved changes",
      });
      await this.tick();
    } catch (error) {
      if (!this.active || epoch !== this.epoch) return;
      if (error instanceof HttpError && [403, 404].includes(error.status)) {
        this.accessCheck = {
          write,
          status: error.status,
          reason: error.message,
        };
        this.update({
          snapshot: null,
          pending: null,
          ...this.history.clear(),
          lastChange: null,
          phase: "verifying",
          message: "Checking workspace access…",
        });
        await this.tick();
        return;
      }
      if (this.accessError(error)) return;
      if (
        error instanceof HttpError &&
        [409, 410, 412].includes(error.status)
      ) {
        this.update({ phase: "conflict", message: error.message });
        await this.tick();
      } else if (
        error instanceof HttpError &&
        error.status < 500 &&
        error.status !== 408
      ) {
        this.update({ phase: "rejected", message: error.message });
      } else {
        this.update({
          phase: "uncertain",
          message:
            "The response was lost. Retry this change to learn whether it was saved.",
        });
      }
    }
  }
}
