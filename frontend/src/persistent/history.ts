import type { Receipt } from "./api.ts";

export class CommandHistory {
  private past: Receipt[] = [];
  private future: Receipt[] = [];

  get current() {
    return { undo: this.past.at(-1) ?? null, redo: this.future.at(-1) ?? null };
  }

  clear() {
    this.past = [];
    this.future = [];
    return this.current;
  }

  acknowledge(name: string, receipt: Receipt) {
    if (name === "undo") {
      this.past.pop();
      if (receipt.undoable) this.future.push(receipt);
    } else {
      if (name === "redo") this.future.pop();
      else this.future = [];
      if (receipt.undoable) {
        this.past.push(receipt);
        if (this.past.length > 100) this.past.shift();
      }
    }
    return this.current;
  }
}
