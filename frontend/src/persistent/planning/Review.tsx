import { useMemo, useState } from "react";
import { usePlanningRead } from "./read.ts";
import type { PlanningSession } from "./read.ts";
import { QueryNotice, ResultList } from "./results.tsx";
import { useVisibleMatches } from "./useVisibleMatches.ts";
import type { ViewActions } from "./results.tsx";
import type { WorkspaceChannel } from "../channel.ts";
import type { OutlineResult } from "../rules.ts";
import type { Snapshot } from "../api.ts";

export type ReviewUnit = "day" | "week" | "month" | "year";
export interface ReviewEntry {
  projectId: string;
  title: string;
  interval: number;
  unit: ReviewUnit;
  lastReviewedAt: string | null;
  nextReview: string;
  version: number;
}
export type ReviewIntent = {
  type: "planning-review";
  name: "mark-reviewed" | "set-review";
  payload: {
    projectId: string;
    expectedVersion: number;
    interval?: number;
    unit?: ReviewUnit;
    nextReview?: string;
  };
};

function ReviewSettings({
  entry,
  base,
  apply,
  close,
}: {
  entry: ReviewEntry;
  base: Snapshot;
  apply: (intent: ReviewIntent, base: Snapshot) => boolean;
  close: () => void;
}) {
  const [interval, setInterval] = useState(String(entry.interval));
  const [unit, setUnit] = useState<ReviewUnit>(entry.unit);
  const [nextReview, setNext] = useState(entry.nextReview);
  return (
    <form
      className="planning-controls"
      aria-label="Review settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          apply(
            {
              type: "planning-review",
              name: "set-review",
              payload: {
                projectId: entry.projectId,
                expectedVersion: entry.version,
                interval: Number(interval),
                unit,
                nextReview,
              },
            },
            base,
          )
        )
          close();
      }}
    >
      <label>
        Review interval{" "}
        <input
          aria-label="Review interval"
          required
          type="number"
          min="1"
          max="999"
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
        />
      </label>
      <label>
        Interval unit{" "}
        <select
          aria-label="Interval unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as ReviewUnit)}
        >
          {(["day", "week", "month", "year"] as const).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        Next review{" "}
        <input
          type="date"
          required
          value={nextReview}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <button type="submit">Save review settings</button>
      <button type="button" onClick={close}>
        Cancel
      </button>
    </form>
  );
}
export function Review({
  session,
  channel,
  disabled,
  personalVersion,
  report,
  ...actions
}: ViewActions & {
  session: PlanningSession;
  channel: WorkspaceChannel;
  disabled: boolean;
  personalVersion: number;
}) {
  const [scope, setScope] = useState<"due" | "all">("due");
  const [chosen, choose] = useState("");
  const [edit, setEdit] = useState<{ entry: ReviewEntry; base: Snapshot }>();
  const queue = usePlanningRead<{ projects: ReviewEntry[] }>(
    session,
    "planning/review?scope=" + scope,
    undefined,
    personalVersion,
  );
  const project =
    queue.data?.projects.find((entry) => entry.projectId === chosen) ??
    queue.data?.projects[0];
  const outline = usePlanningRead<OutlineResult>(
    session,
    project
      ? "outline?" +
          new URLSearchParams({
            view: "projects",
            projectId: project.projectId,
            availability: "everything",
            ...(session.zone ? { viewZone: session.zone } : {}),
          })
      : null,
    undefined,
    personalVersion,
  );
  const entries = new Map(outline.data?.rows.map((r) => [r.id, r]));
  const visible = useMemo(() => {
    if (!project) return queue.data ? [] : undefined;
    if (!outline.data) return undefined;
    const tasks = new Set(session.snapshot.tasks.map((task) => task.id));
    return outline.data.matchIds.filter((id) => tasks.has(id));
  }, [project, queue.data, outline.data, session.snapshot.tasks]);
  useVisibleMatches(report, visible);
  return (
    <section className="planning-page" aria-label="Review">
      <h1>Review</h1>
      <label>
        Review scope{" "}
        <select
          aria-label="Review scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as typeof scope);
            setEdit(undefined);
          }}
        >
          <option value="due">Due for review</option>
          <option value="all">All projects</option>
        </select>
      </label>
      <QueryNotice
        error={queue.error}
        retry={queue.retry}
        loading={!queue.data}
      />
      {queue.data && !queue.data.projects.length && (
        <p>
          {scope === "due"
            ? "No projects due for review."
            : "No projects to review."}
        </p>
      )}
      <div className="planning-controls" role="group" aria-label="Review queue">
        {queue.data?.projects.map((entry) => (
          <button
            key={entry.projectId}
            type="button"
            aria-label={entry.title}
            aria-pressed={entry.projectId === project?.projectId}
            onClick={() => {
              choose(entry.projectId);
              setEdit(undefined);
              actions.select([]);
            }}
          >
            {entry.title}
          </button>
        ))}
      </div>
      {project && (
        <section aria-label="Project review" className="planning-group">
          <h2>{project.title}</h2>
          <p>
            Next review{" "}
            <time dateTime={project.nextReview}>{project.nextReview}</time> ·
            Every {project.interval} {project.unit}
            {project.interval === 1 ? "" : "s"}
          </p>
          {project.lastReviewedAt && (
            <p>
              Last reviewed{" "}
              <time dateTime={project.lastReviewedAt}>
                {new Date(project.lastReviewedAt).toLocaleDateString()}
              </time>
            </p>
          )}
          <div className="planning-actions">
            <button
              disabled={disabled}
              onClick={() =>
                channel.run(
                  {
                    type: "planning-review",
                    name: "mark-reviewed",
                    payload: {
                      projectId: project.projectId,
                      expectedVersion: project.version,
                    },
                  },
                  session.snapshot,
                )
              }
            >
              Mark reviewed
            </button>
            <button
              disabled={disabled}
              onClick={() =>
                setEdit({ entry: project, base: session.snapshot })
              }
            >
              Edit review settings
            </button>
          </div>
          {edit && edit.entry.projectId === project.projectId && (
            <ReviewSettings
              key={edit.entry.projectId}
              {...edit}
              apply={(intent, base) => channel.run(intent, base)}
              close={() => setEdit(undefined)}
            />
          )}
          <QueryNotice
            error={outline.error}
            retry={outline.retry}
            loading={!outline.data}
          />
          {outline.data && (
            <ResultList {...actions} entries={entries} ids={visible ?? []} />
          )}
        </section>
      )}
    </section>
  );
}
