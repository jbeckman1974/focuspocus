import { HttpError } from "./api.ts";
import type { Receipt, Snapshot, WorkspaceApi } from "./api.ts";
import { prepare } from "./writes.ts";
import type { Intent, Write } from "./writes.ts";

type Phase = "loading" | "ready" | "sending" | "uncertain" | "acknowledged" | "conflict" | "rejected" | "verifying" | "retryable";
export interface ChannelState {
  snapshot: Snapshot | null;
  phase: Phase;
  pending: Write | null;
  undo: Receipt | null;
  message: string;
  conflictFresh: boolean;
  lastChange: { receipt: Receipt; intent: Intent } | null;
}

export class WorkspaceChannel {
  private api: WorkspaceApi;
  private lostAccess: () => void;
  private listeners = new Set<() => void>();
  private active = true;
  private polling = false;
  private epoch = 0;
  private accessCheck: {write: Write; status: number; reason: string} | null = null;
  private state: ChannelState = {
    snapshot: null, phase: "loading", pending: null, undo: null,
    message: "", conflictFresh: false, lastChange: null,
  };

  constructor(api: WorkspaceApi, lostAccess: () => void) {
    this.api = api;
    this.lostAccess = lostAccess;
  }

  getSnapshot = () => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  };

  stop() {
    this.active = false;
    this.epoch++;
  }

  private update(next: Partial<ChannelState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach(fn => fn());
  }

  private accessError(error: unknown) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status)) {
      this.update({ snapshot: null, pending: null, undo: null, lastChange: null, phase: "loading" });
      this.accessCheck = null;
      this.stop();
      this.lostAccess();
      return true;
    }
    return false;
  }

  tick = async () => {
    if (!this.active || this.polling || this.state.phase === "sending") return;
    const epoch = this.epoch;
    this.polling = true;
    try {
      const { snapshot, phase } = this.state;
      if (phase === "verifying" && this.accessCheck) {
        const {write, status, reason} = this.accessCheck;
        const canWrite = await this.api.verifySession();
        const next = await this.api.snapshot();
        if (!this.active || epoch !== this.epoch) return;
        this.accessCheck = null;
        const retryable = status === 403 && canWrite;
        this.update({ snapshot: next, pending: write, phase: retryable ? "retryable" : "rejected",
          message: retryable ? "Your session was refreshed. Retry the original change." : reason });
        return;
      }
      let refresh = !snapshot || phase === "acknowledged" || (phase === "conflict" && !this.state.conflictFresh);
      if (!refresh && snapshot) {
        try {
          const page = await this.api.changes(snapshot.cursor);
          refresh = page.changes.length > 0 || page.revision !== snapshot.revision;
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 410)) throw error;
          refresh = true;
        }
      }
      if (!refresh) {
        if (this.active && epoch === this.epoch && this.state.message === "Connection interrupted. Reconnecting…") this.update({message:"Connected."});
        return;
      }
      const next = await this.api.snapshot();
      if (!this.active || epoch !== this.epoch) return;
      if (phase === "acknowledged" && snapshot?.generation === next.generation && next.revision < (this.state.lastChange?.receipt.revision ?? 0)) return;
      this.update({ snapshot: next, conflictFresh: phase === "conflict" });
      if (phase === "acknowledged") {
        const restored = next.generation !== snapshot?.generation;
        this.update({ phase: "ready", pending: null, ...(restored ? {undo:null, lastChange: null} : {}), message: restored ? "Workspace restored. Check your recent changes." : "Saved changes" });
      } else if (phase === "loading") {
        this.update({ phase: "ready", message: "" });
      } else if (snapshot?.generation !== next.generation) {
        this.update({ undo: null, message: "Workspace restored. Check the current values before making changes." });
      }
    } catch (error) {
      if (!this.active || epoch !== this.epoch || this.accessError(error)) return;
      if (this.state.phase === "ready" || this.state.phase === "loading") {
        this.update({ message: "Connection interrupted. Reconnecting…" });
      }
    } finally {
      this.polling = false;
    }
  };

  run(intent: Intent, base = this.state.snapshot): boolean {
    if (!this.active || !base || this.state.phase !== "ready") return false;
    const write = prepare(intent, base);
    void this.send(write);
    return true;
  }

  retry() {
    if (["uncertain", "retryable"].includes(this.state.phase) && this.state.pending) void this.send(this.state.pending);
  }

  reapply() {
    if (this.state.phase !== "conflict" || !this.state.conflictFresh || !this.state.pending || !this.state.snapshot) return;
    void this.send(prepare(this.state.pending.intent, this.state.snapshot));
  }

  discard() {
    if (!["conflict", "rejected", "retryable"].includes(this.state.phase)) return;
    this.update({ pending: null, phase: "ready", message: "Change discarded." });
  }

  private async send(write: Write) {
    const epoch = ++this.epoch;
    this.update({ phase: "sending", pending: write, message: "Saving…", conflictFresh: false });
    try {
      const receipt = await this.api.submit(write.name, write.envelope);
      if (!this.active || epoch !== this.epoch) return;
      const undo = receipt.undoable ? receipt : write.name === "undo" ? null : this.state.undo;
      this.update({ phase: "acknowledged", undo, lastChange: { receipt, intent: write.intent }, message: "Saved changes" });
      await this.tick();
    } catch (error) {
      if (!this.active || epoch !== this.epoch) return;
      if (error instanceof HttpError && [403, 404].includes(error.status)) {
        this.accessCheck = {write, status: error.status, reason: error.message};
        this.update({snapshot: null, pending: null, undo: null, lastChange: null,
          phase:"verifying", message:"Checking workspace access…"});
        await this.tick();
        return;
      }
      if (this.accessError(error)) return;
      if (error instanceof HttpError && [409, 410, 412].includes(error.status)) {
        this.update({ phase: "conflict", message: error.message });
        await this.tick();
      } else if (error instanceof HttpError && error.status < 500 && error.status !== 408) {
        this.update({ phase: "rejected", message: error.message });
      } else {
        this.update({ phase: "uncertain", message: "The response was lost. Retry this change to learn whether it was saved." });
      }
    }
  }
}
