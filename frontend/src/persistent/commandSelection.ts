import { homeView } from "../workspace/viewState.ts";
import type { View } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";
import type { ChannelState } from "./channel.ts";
import type { OutlineResult } from "./rules.ts";
import type { Intent } from "./writes.ts";

export function selectionAfterWrite(
  staged: ChannelState["lastStaged"],
  change: ChannelState["lastChange"],
  revision: number,
) {
  if (staged && staged.operationId !== change?.receipt.operationId) {
    // The server chooses the surviving IDs for ungroup, duplicate, restore and undo.
    if (["lifecycle", "undo", "redo"].includes(staged.intent.type)) return null;
    return staged;
  }
  return change && revision >= change.receipt.revision
    ? { ...change.receipt, intent: change.intent }
    : null;
}

export function viewAfterTaskWrite(
  snapshot: Snapshot,
  view: View,
  intent: Intent,
  ids: string[],
  first: string,
  result?: OutlineResult,
): View | null {
  const follow =
    intent.type === "capture" ||
    intent.type === "move" ||
    (intent.type === "lifecycle" && intent.change.name === "move");
  if (!follow) return view;
  // A capture or move can leave the current scope. Wait for the matching outline,
  // including contextual rows and children hidden under a collapsed group.
  if (
    result?.revision !== snapshot.revision ||
    result.workspaceId !== snapshot.workspaceId
  )
    return null;
  const visible = new Set(result.rows.map((row) => row.id));
  return ids.every((id) => visible.has(id)) ? view : homeView(snapshot, first);
}
