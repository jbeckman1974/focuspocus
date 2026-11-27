import { useEffect, useId, useState } from "react";
import { TaskLocation } from "../../components/TaskLocation.tsx";
import { indexWorkspace } from "../../outline/tree.ts";
import type { Snapshot } from "../api.ts";
import type { WorkspaceClient } from "./transport.ts";
import { useAction, useResource } from "./hooks.ts";
import { distanceMeters } from "./distance.ts";
import type { Point } from "./distance.ts";

import type { Places } from "./placeDraft.ts";
import { PlaceEditor } from "./PlaceEditor.tsx";

export function Nearby({
  client,
  snapshot,
  editable,
  focusVersion,
  openItem,
}: {
  client: WorkspaceClient;
  snapshot: Snapshot;
  editable: boolean;
  focusVersion: number;
  openItem: (id: string) => void;
}) {
  const data = useResource<Places>(
      client,
      "integrations/places",
      snapshot.revision + "/" + focusVersion,
    ),
    action = useAction();
  const [point, setPoint] = useState<Point>();
  const [manual, setManual] = useState("");
  useEffect(() => {
    function refresh() {
      if (!document.hidden) data.reload();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 10000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [data.reload]);
  const places = data.data?.places ?? [];
  const origin = manual ? places.find((p) => p.tagId === manual) : point;
  const matches = origin
    ? places
        .map((p) => ({ place: p, meters: distanceMeters(origin, p) }))
        .filter((p) => p.meters <= p.place.radiusMeters)
        .sort((a, b) => a.meters - b.meters)
    : [];
  const prefix = useId();
  const { byId, taskLocations } = indexWorkspace(snapshot);
  async function locate() {
    if (!navigator.geolocation)
      throw new Error("Location is unavailable. Choose a saved place instead.");
    const result = await new Promise<GeolocationPosition>((ok, fail) =>
      navigator.geolocation.getCurrentPosition(
        ok,
        () =>
          fail(
            new Error(
              "Location was unavailable or denied. Choose a saved place instead.",
            ),
          ),
        { timeout: 10000, maximumAge: 30000 },
      ),
    );
    client.signal.throwIfAborted();
    setPoint({
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
    });
    setManual("");
  }
  return (
    <>
      <h3>Nearby tasks</h3>
      <button disabled={action.busy} onClick={() => void action.run(locate)}>
        Use current location
      </button>
      <label>
        Or choose a saved place{" "}
        <select
          value={manual}
          onChange={(e) => {
            setManual(e.target.value);
            setPoint(undefined);
          }}
        >
          <option value="">Choose a place</option>
          {places.map((p) => (
            <option value={p.tagId} key={p.tagId}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      {origin &&
        (matches.some((m) => m.place.itemIds.length) ? (
          matches
            .filter((m) => m.place.itemIds.length)
            .map(({ place, meters }) => (
              <section key={place.tagId}>
                <h4>
                  {place.title} · {Math.round(meters)} m
                </h4>
                <ul>
                  {place.itemIds
                    .filter((id) => byId.has(id))
                    .map((id) => (
                      <li key={id}>
                        <button
                          onClick={() => openItem(id)}
                          aria-label={byId.get(id)!.title}
                          aria-describedby={`${prefix}-${place.tagId}-${id}`}
                        >
                          {byId.get(id)!.title}
                        </button>{" "}
                        <TaskLocation
                          location={taskLocations.get(id)!}
                          id={`${prefix}-${place.tagId}-${id}`}
                        />
                      </li>
                    ))}
                </ul>
              </section>
            ))
        ) : (
          <p>No available tasks within these radii.</p>
        ))}
      {editable && (
        <PlaceEditor
          client={client}
          snapshot={snapshot}
          data={data.data}
          accept={data.setData}
          reload={data.reload}
        />
      )}
      {(action.error || data.error) && (
        <p role="alert">
          {action.error || data.error}{" "}
          <button onClick={data.reload}>Refresh places</button>
        </p>
      )}
    </>
  );
}
