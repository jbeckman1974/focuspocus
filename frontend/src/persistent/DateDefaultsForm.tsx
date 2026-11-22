import { useState } from "react";
import type { Snapshot } from "./api.ts";
import type { Intent } from "./writes.ts";
import { dateFields } from "./schedule.ts";

export function DateDefaultsForm({
  base,
  submit,
}: {
  base: Snapshot;
  submit: (intent: Intent) => void;
}) {
  const [zone, setZone] = useState(base.timeZone ?? "UTC");
  const [defaults, setDefaults] = useState(
    base.dateDefaults ?? { defer: "00:00", planned: "00:00", due: "17:00" },
  );
  return (
    <fieldset>
      <legend>Workspace date defaults</legend>
      <label>
        Workspace time zone
        <input
          required
          value={zone}
          onChange={(event) => setZone(event.currentTarget.value)}
        />
      </label>
      {dateFields.map((field) => (
        <label key={field}>
          Default {field} time
          <input
            type="time"
            required
            value={defaults[field]}
            onChange={(event) =>
              setDefaults({ ...defaults, [field]: event.currentTarget.value })
            }
          />
        </label>
      ))}
      <button
        disabled={!zone.trim() || dateFields.some((field) => !defaults[field])}
        onClick={() =>
          submit({
            type: "set-date-settings",
            timeZone: zone.trim(),
            dateDefaults: defaults,
          })
        }
      >
        Save date defaults
      </button>
    </fieldset>
  );
}
