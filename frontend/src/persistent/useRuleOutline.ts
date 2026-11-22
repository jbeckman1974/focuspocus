import { useEffect, useMemo, useState } from "react";
import type { View } from "../outline/index.ts";
import { actorRequest, HttpError } from "./api.ts";
import type { Snapshot } from "./api.ts";
import { outlineQuery } from "./rules.ts";
import type { Availability, OutlineResult } from "./rules.ts";
import { cachedOutline } from "./offline/cachedOutline.ts";

export function useRuleOutline(
  snapshot: Snapshot | null,
  actorId: number,
  view: View,
  availability: Availability,
  viewZone: string,
  refresh: () => Promise<void>,
  personalVersion = 0,
  useLocal = false,
) {
  const id = snapshot?.workspaceId;
  const revision = snapshot?.revision;
  const generation = snapshot?.generation;
  const query =
    outlineQuery(view, availability) +
    (viewZone ? "&viewZone=" + encodeURIComponent(viewZone) : "");
  const key = JSON.stringify([id, actorId, generation, query, personalVersion]);
  const [state, setState] = useState<{
    key: string;
    result?: OutlineResult;
    message?: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  const kind = view.kind;
  const target = "id" in view ? view.id : "";
  const local = useMemo(() => {
    if (!snapshot || !useLocal) return undefined;
    const scope: View =
      kind === "project" || kind === "folder" || kind === "tag"
        ? { kind, id: target }
        : { kind };
    return cachedOutline(snapshot, scope, availability);
  }, [snapshot, useLocal, kind, target, availability]);
  useEffect(() => {
    if (useLocal || !id || revision === undefined) return;
    const abort = new AbortController();
    let timer: number | undefined;
    const fetchOutline = async () => {
      try {
        const data = await actorRequest<OutlineResult>(
          actorId,
          "/api/v1/workspaces/" + encodeURIComponent(id) + "/outline?" + query,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        if (data.workspaceId !== id || data.revision !== revision) {
          await refresh();
          if (!abort.signal.aborted)
            timer = window.setTimeout(fetchOutline, 1000);
          return;
        }
        setState({ key, result: data });
        if (data.nextDateBoundary) {
          const wait = Date.parse(data.nextDateBoundary) - Date.now();
          if (Number.isFinite(wait))
            timer = window.setTimeout(
              fetchOutline,
              Math.max(1000, Math.min(2147483647, wait)),
            );
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        setState({
          key,
          message:
            error instanceof HttpError
              ? error.message
              : "Could not load this outline.",
        });
        if (
          error instanceof HttpError &&
          [401, 403, 404].includes(error.status)
        )
          await refresh();
      }
    };
    void fetchOutline();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [
    id,
    actorId,
    revision,
    generation,
    query,
    key,
    attempt,
    refresh,
    useLocal,
  ]);
  const current = state?.key === key ? state : undefined;
  return {
    result: local ?? current?.result,
    message: local ? undefined : current?.message,
    retry: () => setAttempt((n) => n + 1),
  };
}
