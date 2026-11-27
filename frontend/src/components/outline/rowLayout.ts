/** Prefix heights let keyboard jumps and scroll anchors address every row by ID,
 * including rows the browser has never measured. */
export class RowLayout {
  readonly indices = new Map<string, number>();
  readonly offsets: number[] = [0];
  readonly ids: string[];

  constructor(
    ids: string[],
    measured: ReadonlyMap<string, number>,
    estimate: number,
  ) {
    this.ids = ids;
    for (const [index, id] of ids.entries()) {
      this.indices.set(id, index);
      this.offsets.push(this.offsets[index] + (measured.get(id) ?? estimate));
    }
  }

  indexAt(offset: number) {
    let low = 0;
    let high = this.ids.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.offsets[middle + 1] <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, this.ids.length - 1);
  }

  mounted(top: number, height: number, pins: (string | undefined)[]) {
    const first = Math.max(0, this.indexAt(top) - 6);
    const last = Math.min(this.ids.length - 1, this.indexAt(top + height) + 6);
    const indices = new Set<number>();
    for (let i = first; i <= last; i++) indices.add(i);
    for (const id of pins) {
      const index = id === undefined ? undefined : this.indices.get(id);
      if (index !== undefined) indices.add(index);
    }
    return [...indices].sort((a, b) => a - b);
  }
}
