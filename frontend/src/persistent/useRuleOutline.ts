import { useEffect, useState } from "react";
import type { View } from "../outline/index.ts";
import { HttpError, jsonRequest } from "./api.ts";
import type { Snapshot } from "./api.ts";
import { outlineQuery } from "./rules.ts";
import type { Availability, OutlineResult } from "./rules.ts";

export function useRuleOutline(snapshot: Snapshot | null, view: View, availability: Availability, refresh: () => Promise<void>) {
  const id = snapshot?.workspaceId;
  const revision = snapshot?.revision;
  const generation = snapshot?.generation;
  const query = outlineQuery(view, availability);
  const key = JSON.stringify([id, generation, query]);
  const [state, setState] = useState<{key: string; result?: OutlineResult; message?: string}>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id || revision === undefined) return;
    const abort = new AbortController();
    let timer: number | undefined;
    const fetchOutline = async () => {
      try {
        const data = await jsonRequest<OutlineResult>("/api/v1/workspaces/" + encodeURIComponent(id) + "/outline?" + query, { signal: abort.signal });
        if (abort.signal.aborted) return;
        if (data.workspaceId !== id || data.revision !== revision) {
          await refresh();
          if (!abort.signal.aborted) timer = window.setTimeout(fetchOutline, 1000);
          return;
        }
        setState({ key, result: data });
        if (data.nextEvaluationAt) {
          const wait = Date.parse(data.nextEvaluationAt) - Date.now();
          if (Number.isFinite(wait)) timer = window.setTimeout(fetchOutline, Math.max(1000, Math.min(2147483647, wait)));
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        setState({ key, message: error instanceof HttpError ? error.message : "Could not load this outline." });
        if (error instanceof HttpError && [401, 403, 404].includes(error.status)) await refresh();
      }
    };
    void fetchOutline();
    return () => { abort.abort(); window.clearTimeout(timer); };
  }, [id, revision, generation, query, key, attempt, refresh]);
  const current = state?.key === key ? state : undefined;
  return { result: current?.result, message: current?.message, retry: () => setAttempt(n => n + 1) };
}
