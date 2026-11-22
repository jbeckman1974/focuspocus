/** A serial write queue retains edited fields while newer events arrive during a save. */
import { HttpError } from "../api.ts";

export interface Versioned<T> {
  version: number;
  values: T;
}

interface Options<T, P> {
  initial: T;
  read: () => Promise<Versioned<T>>;
  patch: (version: number, patch: P) => Promise<Versioned<T>>;
  merge: (old: P, patch: P) => P;
  apply: (old: T, patch: P) => T;
}

export class PreferenceResource<T, P extends object> {
  private options: Options<T, P>;
  private base: Versioned<T> | undefined;
  private queued: P | undefined;
  private sending: P | undefined;
  private working = false;
  private stopped = false;
  private listeners = new Set<() => void>();
  private state: { values: T; message: string; failed: boolean };

  constructor(options: Options<T, P>) {
    this.options = options;
    this.state = { values: options.initial, message: "Loading preferences…", failed: false };
  }

  snapshot = () => this.state;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  };

  private emit(message: string, failed = false) {
    if (this.stopped) return;
    let values = this.base?.values ?? this.options.initial;
    if (this.sending) values = this.options.apply(values, this.sending);
    if (this.queued) values = this.options.apply(values, this.queued);
    this.state = { values, message, failed };
    this.listeners.forEach((listener) => listener());
  }

  change = (patch: P) => {
    this.queued = this.queued ? this.options.merge(this.queued, patch) : patch;
    this.emit(this.state.failed ? this.state.message : "Saving preferences…", this.state.failed);
    if (!this.state.failed) void this.flush();
  };

  refresh = async () => {
    if (this.working || this.queued || this.state.failed || this.stopped) return;
    this.base = undefined;
    await this.flush();
  };

  private async flush() {
    if (this.working || this.stopped) return;
    this.working = true;
    try {
      if (!this.base) this.base = await this.options.read();
      while (this.queued && !this.stopped) {
        this.sending = this.queued;
        this.queued = undefined;
        this.emit("Saving preferences…");
        this.base = await this.options.patch(this.base.version, this.sending);
        this.sending = undefined;
      }
      this.emit("");
    } catch (error) {
      if (this.sending) {
        this.queued = this.queued ? this.options.merge(this.sending, this.queued) : this.sending;
        this.sending = undefined;
      }
      this.emit(error instanceof HttpError && error.status === 409
        ? "Another browser changed these preferences. Reload them or reapply your edits."
        : "Preferences could not be saved or loaded.", true);
    } finally {
      this.working = false;
    }
  }

  resolve = (keep: boolean) => {
    if (!this.state.failed) return;
    if (!keep) this.queued = undefined;
    this.base = undefined;
    this.emit("Loading preferences…");
    void this.flush();
  };

  stop() { this.stopped = true; }
}
