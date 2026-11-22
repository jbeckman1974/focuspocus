import { useLayoutEffect, useRef } from "react";
import type { OutlineRow } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";
import type { OutlineResult } from "./rules.ts";
import { resolvedRows, type RowMemory } from "./resolvedCleanup.ts";

interface Options {
  snapshot: Snapshot | null;
  result?: OutlineResult;
  rows: OutlineRow[];
  scope: string;
  collapsed: ReadonlySet<string>;
  cleanupEpoch: number;
}

export function useResolvedRows({snapshot, result, rows, scope, collapsed, cleanupEpoch}: Options) {
  const history = useRef<{key: string; memory: RowMemory[]} | undefined>(undefined);
  const key = JSON.stringify([snapshot?.workspaceId, snapshot?.generation, scope, cleanupEpoch,
                              snapshot?.resolvedCleanup]);
  const ready = snapshot && result && result.workspaceId === snapshot.workspaceId && result.revision === snapshot.revision;
  const previous = history.current?.key === key ? history.current.memory : [];
  const candidate = ready ? resolvedRows(previous, snapshot, rows, collapsed, snapshot.resolvedCleanup === "immediate") : null;
  useLayoutEffect(() => {
    if (candidate) history.current = {key, memory:candidate.memory};
    else if (!snapshot || history.current?.key !== key) history.current = undefined;
  });
  return snapshot ? candidate?.rows ?? rows : [];
}
