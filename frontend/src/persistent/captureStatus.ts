import type { ChannelState } from "./channel.ts";

export function captureStatus(
  state: Pick<
    ChannelState,
    "snapshot" | "reviewOnly" | "lastChange" | "lastStaged" | "queue"
  >,
  submissionId: string | null,
  parentId: string,
  destination: string,
): string | null {
  if (!submissionId || !state.snapshot || state.reviewOnly) return null;
  const { lastChange, lastStaged } = state;
  if (lastChange?.receipt.operationId === submissionId) {
    const { intent, receipt } = lastChange;
    if (
      intent.type !== "capture" ||
      intent.parentId !== parentId ||
      receipt.revision > state.snapshot.revision
    )
      return null;
    const count = receipt.selection.length;
    return `Added ${count} ${count === 1 ? "task" : "tasks"} to ${destination}.`;
  }
  if (
    lastStaged?.operationId !== submissionId ||
    lastStaged.intent.type !== "capture" ||
    lastStaged.intent.parentId !== parentId
  )
    return null;
  const entry = state.queue.find((item) => item.id === submissionId);
  if (entry?.status !== "queued" && entry?.status !== "sent") return null;
  const count = lastStaged.selection.length;
  return `Saved ${count} ${count === 1 ? "task" : "tasks"} for ${destination} on this device. Waiting to sync.`;
}
