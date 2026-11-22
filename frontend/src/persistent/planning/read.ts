import { useEffect, useState } from "react";
import { actorRequest, HttpError, jsonPost, readSession } from "../api.ts";
import type { Snapshot } from "../api.ts";

export interface PlanningSession {
  snapshot: Snapshot;
  actorId: number;
  refresh: () => Promise<void>;
  zone: string;
}

export function workspacePath(workspaceId: string, path: string) {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/${path}`;
}

export async function personalPost<T>(
  workspaceId: string,
  actorId: number,
  path: string,
  body: object,
  signal?: AbortSignal,
) {
  const session = await readSession(signal);
  if (
    session.user?.id !== actorId ||
    !session.workspaces.some((member) => member.id === workspaceId)
  )
    throw new HttpError(403, "Workspace access changed.");
  return actorRequest<T>(actorId, workspacePath(workspaceId, path), {
    ...jsonPost(session.csrfToken, body),
    signal,
  });
}

export function usePlanningRead<T>(
  session: PlanningSession,
  path: string | null,
  body?: object,
  personalVersion = 0,
) {
  const { snapshot, actorId, refresh } = session;
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const key = JSON.stringify([
    actorId,
    snapshot.workspaceId,
    snapshot.generation,
    snapshot.revision,
    personalVersion,
    path,
    serialized,
  ]);
  const [value, setValue] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function load() {
      try {
        const result = await (serialized === undefined
          ? actorRequest<T>(
              actorId,
              workspacePath(snapshot.workspaceId, path!),
              {
                signal: controller.signal,
              },
            )
          : personalPost<T>(
              snapshot.workspaceId,
              actorId,
              path!,
              JSON.parse(serialized),
              controller.signal,
            ));
        if (controller.signal.aborted) return;
        const meta = result as {
          revision?: number;
          workspaceId?: string;
          nextDateBoundary?: string;
        };
        if (
          meta.workspaceId !== undefined &&
          meta.workspaceId !== snapshot.workspaceId
        )
          throw new Error("Unexpected workspace response.");
        if (
          meta.revision !== undefined &&
          meta.revision !== snapshot.revision
        ) {
          await refresh();
          if (!controller.signal.aborted) timer = window.setTimeout(load, 1200);
          return;
        }
        setValue({ key, data: result });
        if (meta.nextDateBoundary) {
          const wait = Date.parse(meta.nextDateBoundary) - Date.now();
          if (Number.isFinite(wait))
            timer = window.setTimeout(
              load,
              Math.max(1000, Math.min(2147483647, wait)),
            );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setValue({
          key,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load this view.",
        });
        if (
          error instanceof HttpError &&
          [401, 403, 404].includes(error.status)
        )
          void refresh();
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    actorId,
    key,
    path,
    refresh,
    serialized,
    snapshot.workspaceId,
    snapshot.revision,
    attempt,
  ]);
  return {
    data: value?.key === key ? value.data : undefined,
    error: value?.key === key ? value.error : undefined,
    retry: () => retry((n) => n + 1),
  };
}
