import { RepeatPreview } from "./RepeatPreview.tsx";
import type { RepeatPreviewRequest } from "./repeat.ts";
import { useEffect, useRef, useState } from "react";
import type { Entry } from "../outline/index.ts";
import { dateFields } from "./schedule.ts";
import type { DateField } from "./schedule.ts";
import type { RuleFields } from "./rules.ts";
import { repeatUnits, withFrequency } from "./repeat.ts";
import type { RepeatChange, RepeatRule, RepeatUnit } from "./repeat.ts";
import { RepeatPattern } from "./RepeatPattern.tsx";

export function RepeatDialog({
  entry,
  apply,
  close,
  preview,
  revision,
}: {
  entry: Entry & RuleFields;
  apply: (change: RepeatChange) => boolean;
  close: () => void;
  preview:RepeatPreviewRequest;
  revision:number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const occurrence = entry.repeat;
  const fields = dateFields.filter((field) => entry.schedule?.[field]);
  const [rule, setRule] = useState<RepeatRule>(
    occurrence?.rule ?? {
      schedule: "regular",
      unit: "day",
      interval: 1,
      ...(fields[0] ? { anchor: fields[0] } : {}),
    },
  );
  const [completedAt, setCompletedAt] = useState(occurrence?.resolvedAt ?? "");
  const [error, setError] = useState("");
  const [patternError, setPatternError] = useState("");
  const [ending, setEnding] = useState(
    rule.count ? "count" : rule.endDate ? "date" : "never",
  );
  const historical = Boolean(occurrence && occurrence.outcome !== "open");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function submit(change: RepeatChange) {
    if (apply(change)) close();
    else setError("Finish the pending change before editing this series.");
  }
  return (
    <dialog
      ref={dialog}
      className="fp-dialog schedule-dialog"
      aria-labelledby="repeat-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="repeat-heading">Edit repetition</h2>
        <button onClick={close}>Close</button>
      </header>
      <p>{entry.title}</p>
      {occurrence && (
        <p>
          Occurrence: {occurrence.outcome}
          {occurrence.remaining !== null
            ? " · Remaining: " + occurrence.remaining
            : ""}
          {!occurrence.active && " · Series stopped"}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit({
            name: "set-repeat",
            payload: {
              id: entry.id,
              rule,
              ...(occurrence
                ? { seriesVersion: occurrence.seriesVersion }
                : {}),
            },
          });
        }}
      >
        <fieldset disabled={historical || !fields.length}>
          <legend>Repeat rule</legend>
          <label>
            Schedule from
            <select
              value={rule.schedule}
              onChange={(event) => {
                const schedule = event.currentTarget
                  .value as RepeatRule["schedule"];
                setRule({
                  ...rule,
                  schedule,
                  catchUp: schedule === "completion" ? false : rule.catchUp,
                });
              }}
            >
              <option value="regular">Scheduled dates</option>
              <option value="completion">Completion</option>
            </select>
          </label>
          <label>
            Repeat interval
            <input
              type="number"
              min="1"
              max="10000"
              required
              value={rule.interval || ""}
              onChange={(event) =>
                setRule({
                  ...rule,
                  interval: Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label>
            Repeat unit
            <select
              value={rule.unit}
              onChange={(event) => {
                setPatternError("");
                setRule(
                  withFrequency(rule, event.currentTarget.value as RepeatUnit),
                );
              }}
            >
              {repeatUnits.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date anchor
            <select
              value={rule.anchor ?? ""}
              onChange={(event) =>
                setRule({
                  ...rule,
                  anchor: event.currentTarget.value as DateField,
                })
              }
            >
              {!rule.anchor && (
                <option value="" disabled>
                  Choose date
                </option>
              )}
              {fields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          {rule.schedule === "regular" && (
            <label>
              <input
                type="checkbox"
                checked={rule.catchUp ?? false}
                onChange={(event) =>
                  setRule({ ...rule, catchUp: event.currentTarget.checked })
                }
              />
              Skip missed occurrences
            </label>
          )}
          <RepeatPattern
            rule={rule}
            change={setRule}
            invalid={setPatternError}
          />
          <label>
            Repeat ending
            <select
              value={ending}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setEnding(value);
                const next = { ...rule };
                delete next.count;
                delete next.endDate;
                if (value === "count") next.count = 1;
                if (value === "date") next.endDate = "";
                setRule(next);
              }}
            >
              <option value="never">No ending</option>
              <option value="count">After a number of occurrences</option>
              <option value="date">On a date</option>
            </select>
          </label>
          {ending === "date" && (
            <label>
              End date
              <input
                type="date"
                required
                value={rule.endDate ?? ""}
                onChange={(event) =>
                  setRule({ ...rule, endDate: event.currentTarget.value })
                }
              />
            </label>
          )}
          {ending === "count" && (
            <label>
              Occurrence count
              <input
                type="number"
                min="1"
                max="1000000"
                required
                value={rule.count || ""}
                onChange={(event) =>
                  setRule({ ...rule, count: Number(event.currentTarget.value) })
                }
              />
            </label>
          )}
          <RepeatPreview id={entry.id} rule={rule} revision={revision} read={preview}/>
        <button
            type="submit"
            disabled={
              Boolean(patternError) ||
              (rule.ordinal !== undefined && !rule.ordinal.days.length)
            }
          >
            Save repeat
          </button>
        </fieldset>
      </form>
      {!fields.length && (
        <p>Set a defer, planned or due date to start a repeat.</p>
      )}
      {occurrence?.active && !historical && (
        <div>
          <button
            onClick={() =>
              submit({
                name: "skip-occurrence",
                payload: {
                  id: entry.id,
                  seriesVersion: occurrence.seriesVersion,
                },
              })
            }
          >
            Skip this occurrence
          </button>
          <button
            onClick={() =>
              submit({
                name: "stop-series",
                payload: {
                  id: entry.id,
                  seriesVersion: occurrence.seriesVersion,
                },
              })
            }
          >
            Stop repeating
          </button>
        </div>
      )}
      {occurrence?.outcome === "completed" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !/(Z|[+-]\d\d:\d\d)$/i.test(completedAt) ||
              !Number.isFinite(Date.parse(completedAt))
            ) {
              setError("Enter a timestamp including its UTC offset.");
              return;
            }
            submit({
              name: "set-completion-time",
              payload: {
                id: entry.id,
                seriesVersion: occurrence.seriesVersion,
                completedAt,
              },
            });
          }}
        >
          <label>
            Completion timestamp with UTC offset
            <input
              required
              value={completedAt}
              onChange={(event) => setCompletedAt(event.currentTarget.value)}
            />
          </label>
          <button>Save completion time</button>
        </form>
      )}
      {(error || patternError) && <p role="alert">{error || patternError}</p>}
    </dialog>
  );
}
