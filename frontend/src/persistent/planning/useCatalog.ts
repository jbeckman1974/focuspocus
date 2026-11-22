import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../api.ts";
import { actorRequest, HttpError } from "../api.ts";
import type { Catalog, PersonalChange } from "./perspective.ts";
import { personalPost, workspacePath } from "./read.ts";

interface Envelope {
  context: string;
  operationId: string;
  expectedVersion: number;
  action: PersonalChange["action"];
  payload: PersonalChange["payload"];
}
interface Attempt {
  envelope: Envelope;
  condition: "sending" | "retry" | "conflict" | "rejected";
  message: string;
}
export function useCatalog(
  snapshot: Snapshot | null,
  actorId: number,
  refresh: () => Promise<void>,
) {
  const id = snapshot?.workspaceId,
    generation = snapshot?.generation;
  const [data, setData] = useState<Catalog>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Attempt>();
  const request = useRef<AbortController | undefined>(undefined);
  const busy = useRef(false);
  const accept = useCallback(
    (next: Catalog) =>
      setData((old) =>
        old && old.personalVersion > next.personalVersion ? old : next,
      ),
    [],
  );
  const read = useCallback(async () => {
    const signal = request.current?.signal;
    if (!id || !signal || signal.aborted) return;
    try {
      const next = await actorRequest<Catalog>(
        actorId,
        workspacePath(id, "perspectives/"),
        { signal },
      );
      if (!signal.aborted) {
        accept(next);
        setError("");
      }
    } catch (e) {
      if (signal.aborted) return;
      setError(e instanceof Error ? e.message : "Unable to load perspectives.");
      if (e instanceof HttpError && [401, 403, 404].includes(e.status)) {
        setData(undefined);
        void refresh();
      }
    }
  }, [id, actorId, accept, refresh]);
  useEffect(() => {
    const abort = new AbortController();
    request.current = abort;
    setData(undefined);
    setPending(undefined);
    setError("");
    busy.current = false;
    if (!id) return () => abort.abort();
    void read();
    const timer = window.setInterval(() => {
      if (!document.hidden) void read();
    }, 4000);
    window.addEventListener("focus", read);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [id, generation, actorId, read]);
  const send = async (envelope: Envelope) => {
    const signal = request.current?.signal;
    if (!id || !signal || signal.aborted || busy.current) return false;
    busy.current = true;
    setPending({
      envelope,
      condition: "sending",
      message: "Saving personal changes…",
    });
    try {
      const next = await personalPost<Catalog>(
        id,
        actorId,
        "perspectives/commands",
        envelope,
        signal,
      );
      if (signal.aborted) return false;
      accept(next);
      setPending(undefined);
      return true;
    } catch (e) {
      if (signal.aborted) return false;
      const status = e instanceof HttpError ? e.status : undefined;
      setPending({
        envelope,
        condition:
          status === 409
            ? "conflict"
            : status && status < 500
              ? "rejected"
              : "retry",
        message:
          e instanceof Error ? e.message : "The change was not acknowledged.",
      });
      if (status === 409) await read();
      if (status && [401, 403, 404].includes(status)) {
        setData(undefined);
        void refresh();
        await read();
      }
      return false;
    } finally {
      if (!signal.aborted) busy.current = false;
    }
  };
  const save = (change: PersonalChange, expectedVersion?: number) => {
    if (!snapshot || !data || pending) return Promise.resolve(false);
    return send({
      ...change,
      context: snapshot.context,
      operationId: crypto.randomUUID(),
      expectedVersion: expectedVersion ?? data.personalVersion,
    });
  };
  const retry = async () => {
    if (!snapshot || !data || !pending || busy.current) return false;
    if (pending.condition === "retry") return send(pending.envelope);
    if (pending.condition === "conflict")
      return send({
        ...pending.envelope,
        expectedVersion: data.personalVersion,
        context: snapshot.context,
        operationId: crypto.randomUUID(),
      });
    return false;
  };
  return {
    data,
    error,
    pending,
    save,
    retry,
    discard: () => {
      if (!busy.current) setPending(undefined);
    },
    read,
  };
}
export type CatalogActions = ReturnType<typeof useCatalog>;
