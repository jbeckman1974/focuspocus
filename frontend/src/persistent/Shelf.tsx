import { useEffect, useState } from "react";
import type { Snapshot } from "./api.ts";
import { actorRequest } from "./api.ts";
import type { LifecycleChange, ShelfItem } from "./lifecycle.ts";

export type ShelfPage = "trash" | "archive" | "preview";

export function Shelf({
  actorId,
  page,
  snapshot,
  submit,
}: {
  actorId: number;
  page: ShelfPage;
  snapshot: Snapshot;
  submit: (change: LifecycleChange, revision?: number) => void;
}) {
  const [before, setBefore] = useState("");
  const [parent, setParent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [data, setData] = useState<{ items: ShelfItem[]; revision: number }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setData(undefined);
    setSelected([]);
    setError("");
    if (page === "preview" && !before) return;
    const controller = new AbortController();
    const path =
      page === "preview"
        ? "archive-preview?before=" + encodeURIComponent(before)
        : "shelf?state=" + page;
    void actorRequest<{ items: ShelfItem[]; revision: number }>(
      actorId,
      "/api/v1/workspaces/" +
        encodeURIComponent(snapshot.workspaceId) +
        "/" +
        path,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load these items.");
      });
    return () => controller.abort();
  }, [
    actorId,
    snapshot.workspaceId,
    snapshot.generation,
    snapshot.revision,
    page,
    before,
    attempt,
  ]);
  const containers = [
    ...(snapshot.folders ?? []),
    ...snapshot.projects,
    ...snapshot.tasks.filter((t) => t.kind === "group"),
  ];
  return (
    <section
      aria-label={
        page === "trash"
          ? "Trash"
          : page === "archive"
            ? "Archive"
            : "Archive preview"
      }
    >
      {page === "preview" && (
        <label>
          Archive items resolved before
          <input
            type="date"
            value={before}
            onChange={(event) => setBefore(event.currentTarget.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}
      {data && !data.items.length && <p>No items found.</p>}
      {data && data.items.length > 0 && page !== "preview" && (
        <label>
          Restore destination
          <select
            value={parent}
            onChange={(event) => setParent(event.currentTarget.value)}
          >
            <option value="">Original location</option>
            <option value="inbox">Inbox</option>
            <option value="root">Project list</option>
            {containers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <ul>
        {data?.items.map((item) => (
          <li key={item.id}>
            {page === "preview" ? (
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected(
                      event.currentTarget.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.title}
                {Boolean(item.descendantCount) &&
                  ` (includes ${item.descendantCount} descendants)`}
              </label>
            ) : item.shelfRootId === item.id ? (
              <button
                onClick={() =>
                  submit(
                    {
                      name: page === "trash" ? "restore" : "retrieve",
                      payload: {
                        ids: [item.id],
                        ...(parent ? { parentId: parent } : {}),
                      },
                    },
                    data.revision,
                  )
                }
              >
                {page === "trash" ? "Restore" : "Retrieve"} {item.title}
              </button>
            ) : (
              <span>{item.title} · included with its removed parent</span>
            )}
          </li>
        ))}
      </ul>
      {page === "preview" && (
        <button
          disabled={!data || !selected.length}
          onClick={() =>
            submit(
              { name: "archive", payload: { ids: selected, before } },
              data?.revision,
            )
          }
        >
          Archive selected items
        </button>
      )}
    </section>
  );
}
