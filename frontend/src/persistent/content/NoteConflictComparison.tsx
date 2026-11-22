import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../api.ts";
import { offlineEvents } from "../offline/storeEvents.ts";
import { authorizedContent } from "./authorizedContent.ts";
import { contentLease } from "./trustedItem.ts";
import { noteExcerpt } from "./noteExcerpt.ts";
import type { OfflineContent } from "./offlineContent.ts";

type NoteChange = Extract<OfflineContent, { action: "save" }>;
interface ReviewedNote {
  itemId: string;
  itemVersion: number;
  generation: string;
  grantId: string;
}
interface Props {
  actorId: number;
  snapshot: Snapshot;
  change: NoteChange;
  offline: boolean;
  canReapply: boolean;
  reapply: (reviewed: ReviewedNote) => void;
}

export function NoteConflictComparison({
  actorId,
  snapshot,
  change,
  offline,
  canReapply,
  reapply,
}: Props) {
  const [review, setReview] = useState<{
    current: string;
    identity: ReviewedNote;
  }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const clear = () => {
      request.current?.abort();
      setReview(undefined);
      setMessage("");
      setBusy(false);
    };
    const unsubscribe = offlineEvents((kind) => {
      if (kind !== "data") clear();
    });
    window.addEventListener("offline", clear);
    return () => {
      request.current?.abort();
      unsubscribe();
      window.removeEventListener("offline", clear);
    };
  }, []);

  async function compare() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setReview(undefined);
    setMessage("");
    try {
      const lease = await contentLease(actorId, snapshot);
      const data = await authorizedContent(
        lease,
        change.itemId,
        controller.signal,
      );
      const task = snapshot.tasks.find((task) => task.id === change.itemId);
      if (
        !task ||
        data.itemVersion !== task.version ||
        data.revision !== snapshot.revision
      )
        throw new Error(
          "The task changed. Wait for the workspace to refresh, then compare again.",
        );
      const identity = {
        itemId: change.itemId,
        itemVersion: data.itemVersion,
        generation: lease.generation,
        grantId: lease.grantId,
      };
      if (!controller.signal.aborted)
        setReview({ current: noteExcerpt(data.document), identity });
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error ? error.message : "Current note unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={offline || busy}
        onClick={() => void compare()}
      >
        Compare note versions
      </button>
      {message && <p role="status">{message}</p>}
      {review && !offline && (
        <dl>
          <dt>Before the edit</dt>
          <dd>
            <pre>
              {change.originalText === undefined
                ? "Original note unavailable for this earlier draft."
                : noteExcerpt({
                    paragraphs: [[{ text: change.originalText }]],
                  }) || "(Empty note)"}
            </pre>
          </dd>
          <dt>Your draft</dt>
          <dd>
            <pre>{noteExcerpt(change.document) || "(Empty note)"}</pre>
          </dd>
          <dt>On the server</dt>
          <dd>
            <pre>{review.current || "(Empty note)"}</pre>
          </dd>
        </dl>
      )}
      {canReapply && (
        <button
          disabled={!review || offline || busy}
          onClick={() => {
            if (review) reapply(review.identity);
          }}
        >
          Reapply change
        </button>
      )}
    </>
  );
}
