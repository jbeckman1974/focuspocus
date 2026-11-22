// A workspace may configure a lower limit after the task metadata was read.
export function knownFileLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function attachmentLimit(snapshot: number | undefined, item?: number) {
  const limits = [snapshot, item].filter(knownFileLimit);
  return limits.length ? Math.min(...limits) : 0;
}
