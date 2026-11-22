import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceClient } from "./transport.ts";
import { WorkspaceFailure } from "./transport.ts";

export function feedback(error: unknown) {
  if (error instanceof WorkspaceFailure && error.conflicts.length)
    return [error.message, ...new Set(error.conflicts)].join(" · ");
  return error instanceof Error
    ? error.message
    : "Unable to complete this request.";
}

export function useResource<T>(
  client: WorkspaceClient,
  path: string,
  version = "",
) {
  const [data, storeData] = useState<T>();
  const order = useRef(0);
  const setData = useCallback((value: T) => {
    order.current++;
    storeData(value);
    setError("");
  }, []);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    const read = ++order.current;
    setError("");
    client
      .json<T>(path)
      .then((value) => {
        if (live && read === order.current) storeData(value);
      })
      .catch((e) => {
        if (live && read === order.current && !client.signal.aborted) {
          storeData(undefined);
          setError(feedback(e));
        }
      });
    return () => {
      live = false;
    };
  }, [client, path, revision, version]);
  return { data, setData, error, reload };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError(feedback(e));
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, run };
}
