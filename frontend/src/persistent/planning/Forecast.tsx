import { useMemo, useState } from "react";
import type { Entry } from "../../outline/index.ts";
import { forecastDefaults, forecastPath, sectionNames } from "./forecast.ts";
import type { ForecastOptions } from "./forecast.ts";
import { usePlanningRead } from "./read.ts";
import type { PlanningSession } from "./read.ts";
import { QueryNotice, ResultList } from "./results.tsx";
import { useVisibleMatches } from "./useVisibleMatches.ts";
import type { ViewActions } from "./results.tsx";

interface ForecastData {
  today: string;
  rows: Entry[];
  days: {
    date: string;
    sections: { kind: string; ids: string[] }[];
    matchIds: string[];
  }[];
}
export function Forecast({
  session,
  personalVersion,
  report,
  ...actions
}: ViewActions & { session: PlanningSession; personalVersion: number }) {
  const [options, update] = useState(forecastDefaults);
  const change = <K extends keyof ForecastOptions>(
    key: K,
    value: ForecastOptions[K],
  ) => update((old) => ({ ...old, [key]: value }));
  const result = usePlanningRead<ForecastData>(
    session,
    forecastPath(options, session.zone),
    undefined,
    personalVersion,
  );
  const matches = useMemo(() => {
    if (!result.data) return undefined;
    return [...new Set(result.data.days.flatMap((day) => day.matchIds))];
  }, [result.data]);
  useVisibleMatches(report, matches);
  const entries = new Map(result.data?.rows.map((entry) => [entry.id, entry]));
  return (
    <section className="planning-page" aria-label="Forecast">
      <h1>Forecast</h1>
      <div className="planning-controls">
        <label>
          Start date{" "}
          <input
            type="date"
            value={options.start || result.data?.today || ""}
            onChange={(e) => change("start", e.target.value)}
          />
        </label>
        <button onClick={() => change("start", "")}>Today</button>
        <label>
          Days shown{" "}
          <select
            aria-label="Days shown"
            value={options.days}
            onChange={(e) => change("days", Number(e.target.value))}
          >
            {[1, 3, 7, 14, 30].map((days) => (
              <option key={days}>{days}</option>
            ))}
          </select>
        </label>
        <label>
          Forecast layout{" "}
          <select
            aria-label="Forecast layout"
            value={options.layout}
            onChange={(e) =>
              change("layout", e.target.value as ForecastOptions["layout"])
            }
          >
            <option value="grouped">Grouped</option>
            <option value="combined">Combined</option>
          </select>
        </label>
        {(
          [
            ["planned", "Planned"],
            ["deferred", "Deferred"],
            ["flagged", "Flagged today"],
            ["includeHeld", "Include held"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) => change(key, e.target.checked)}
            />{" "}
            {label}
          </label>
        ))}
        <label>
          Today tag{" "}
          <select
            aria-label="Today tag"
            value={options.tagId}
            onChange={(e) => change("tagId", e.target.value)}
          >
            <option value="">None</option>
            {session.snapshot.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryNotice
        error={result.error}
        retry={result.retry}
        loading={!result.data}
      />
      {result.data?.days.map((day) => (
        <section key={day.date} aria-label={day.date} className="planning-day">
          <h2>
            <time dateTime={day.date}>
              {new Intl.DateTimeFormat(undefined, {
                weekday: "short",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(day.date + "T12:00:00Z"))}
            </time>
          </h2>
          {day.sections
            .filter((section) => section.ids.length > 0)
            .map((section) => (
              <section
                key={section.kind}
                aria-label={sectionNames[section.kind] ?? section.kind}
              >
                {options.layout === "grouped" && (
                  <h3>{sectionNames[section.kind] ?? section.kind}</h3>
                )}
                <ResultList {...actions} ids={section.ids} entries={entries} />
              </section>
            ))}
          {!day.matchIds.length && (
            <p className="planning-empty">No scheduled tasks</p>
          )}
        </section>
      ))}
    </section>
  );
}
