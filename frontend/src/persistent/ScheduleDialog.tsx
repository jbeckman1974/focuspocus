import { useEffect, useRef, useState } from "react";
import type { Entry } from "../outline/index.ts";
import { jsonRequest } from "./api.ts";
import type { Snapshot } from "./api.ts";
import type { RuleFields } from "./rules.ts";
import {
  dateFields,
  describeDate,
  durationMinutes,
  previewQuery,
} from "./schedule.ts";
import type {
  DateChanges,
  DateField,
  DatePreview,
  TimeKind,
} from "./schedule.ts";

export function ScheduleDialog({
  entry,
  base,
  apply,
  showSource,
  close,
}: {
  entry: Entry & RuleFields;
  base: Snapshot;
  apply: (changes: DateChanges) => boolean;
  close: () => void;
  showSource:(id:string)=>void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [field, setField] = useState<DateField>("due");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<TimeKind>("floating");
  const [zone, setZone] = useState(base.timeZone ?? "UTC");
  const [fold, setFold] = useState<0 | 1>(0);
  const [duration, setDuration] = useState(
    entry.durationMinutes?.toString() ?? "",
  );
  const [result, setResult] = useState<{
    query: string;
    preview: DatePreview;
  }>();
  const [message, setMessage] = useState("");
  const query = previewQuery(field, text, kind, zone, fold, base.viewZone);
  const confirmed = result?.query === query ? result.preview : undefined;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      request.current?.abort();
      element?.close();
    };
  }, []);
  async function preview() {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setResult(undefined);
    setMessage("Checking date…");
    try {
      const data = await jsonRequest<DatePreview>(
        "/api/v1/workspaces/" +
          encodeURIComponent(base.workspaceId) +
          "/date-preview?" +
          query,
        { signal: abort.signal },
      );
      if (!abort.signal.aborted) {
        setResult({ query, preview: data });
        setMessage("");
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setMessage(
          error instanceof Error ? error.message : "Date preview failed.",
        );
    }
  }
  function submit(changes: DateChanges) {
    if (apply(changes)) close();
    else setMessage("Finish the pending change before editing this schedule.");
  }
  const current = entry.schedule?.[field];
  const effective = entry.effective?.schedule?.[field];
  const source =
    effective &&
    [...base.tasks, ...base.projects, ...(base.folders ?? [])].find(
      (item) => item.id === effective.source,
    );
  return (
    <dialog
      ref={dialog}
      className="fp-dialog schedule-dialog"
      aria-labelledby="schedule-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="schedule-heading">Edit schedule</h2>
        <button onClick={close}>Close</button>
      </header>
      <p>{entry.title}</p>
      <label>
        Date field
        <select
          value={field}
          onChange={(event) => {
            setField(event.currentTarget.value as DateField);
            setText("");
            setResult(undefined);
            setMessage("");
          }}
        >
          {dateFields.map((value) => (
            <option key={value} value={value}>
              {value[0]!.toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <p>
        Direct {field}: {describeDate(current)}
      </p>
      {effective && (
        <p>
          Effective {field}: {describeDate(effective.value)}
          {source && source.id !== entry.id && <> from <button type="button" onClick={()=>showSource(source.id)}>{source.title}</button></>}
        </p>
      )}
      <label>
        Date input
        <input
          value={text}
          placeholder={
            kind === "instant" ? "2026-11-01T09:00-05:00" : "Tomorrow at 09:00"
          }
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </label>
      <label>
        Time interpretation
        <select
          value={kind}
          onChange={(event) => setKind(event.currentTarget.value as TimeKind)}
        >
          <option value="floating">Floating local time</option>
          <option value="zoned">Fixed time in a zone</option>
          <option value="instant">Timestamp with UTC offset</option>
        </select>
      </label>
      {kind === "zoned" && (
        <label>
          Time zone
          <input
            value={zone}
            onChange={(event) => setZone(event.currentTarget.value)}
          />
        </label>
      )}
      {kind !== "instant" && (
        <label>
          Repeated clock hour
          <select
            value={fold}
            onChange={(event) =>
              setFold(event.currentTarget.value === "1" ? 1 : 0)
            }
          >
            <option value="0">First occurrence</option>
            <option value="1">Second occurrence</option>
          </select>
        </label>
      )}
      <button
        onClick={preview}
        disabled={!text.trim() || (kind === "zoned" && !zone.trim())}
      >
        Preview date
      </button>
      {confirmed && (
        <p role="status">
          {confirmed.display} · {confirmed.zone} · {confirmed.instant}
        </p>
      )}
      <button
        disabled={!confirmed}
        onClick={() =>
          confirmed && submit({ schedule: { [field]: confirmed.value } })
        }
      >
        Apply date
      </button>
      <button
        disabled={!current}
        onClick={() => submit({ schedule: { [field]: null } })}
      >
        Clear {field}
      </button>
      <fieldset>
        <legend>Estimated duration</legend>
        <label>
          Minutes
          <input
            inputMode="numeric"
            value={duration}
            onChange={(event) => setDuration(event.currentTarget.value)}
          />
        </label>
        <button
          onClick={() => {
            try {
              submit({ durationMinutes: durationMinutes(duration) });
            } catch (error) {
              setMessage((error as Error).message);
            }
          }}
        >
          Save duration
        </button>
      </fieldset>
      {message && <p role="alert">{message}</p>}
    </dialog>
  );
}
