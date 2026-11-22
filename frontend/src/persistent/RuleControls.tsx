import type { Entry } from "../outline/index.ts";
import type { Availability, ItemStatus, Mode, Properties, RuleFields } from "./rules.ts";

export function AvailabilityFilter({value, change}: {value: Availability; change: (value: Availability) => void}) {
  return <label className="rule-field">Availability
    <select value={value} onChange={event => change(event.currentTarget.value as Availability)}>
      <option value="everything">Everything</option>
      <option value="remaining">Remaining</option>
      <option value="available">Available</option>
      <option value="blocked">Blocked</option>
      <option value="first-available">First Available</option>
    </select>
  </label>;
}

export function RuleControls({entry, kind, pending, disabled, change}: {
  entry: Entry & RuleFields;
  kind: "project" | "group" | "action" | "folder";
  pending?: Properties;
  disabled: boolean;
  change: (properties: Properties) => void;
}) {
  const direct = {...entry, ...pending};
  const container = kind === "project" || kind === "group";
  const label = kind[0]!.toUpperCase() + kind.slice(1);
  return <fieldset className="rule-controls" disabled={disabled}>
    <legend>{label} properties</legend>
    {container && <label className="rule-field">{label} mode
      <select value={direct.mode ?? "parallel"} onChange={event => change({mode: event.currentTarget.value as Mode})}>
        <option value="parallel">Parallel</option>
        <option value="sequential">Sequential</option>
        {kind === "project" && <option value="single-action">Single-action list</option>}
      </select>
    </label>}
    <label className="rule-field">{label} status
      <select value={direct.status ?? "active"} onChange={event => change({status: event.currentTarget.value as ItemStatus})}>
        <option value="active">Active</option>
        {kind === "project" && <option value="held">On hold</option>}
        {kind !== "folder" && <option value="completed">Completed</option>}
        <option value="dropped">Dropped</option>
      </select>
    </label>
    {kind !== "folder" && <label className="rule-check">
      <input type="checkbox" checked={direct.flagged ?? false} onChange={event => change({flagged: event.currentTarget.checked})} />
      Flag {kind}
    </label>}
    {container && direct.mode !== "single-action" && <label className="rule-check">
      <input type="checkbox" checked={direct.autoComplete ?? false} onChange={event => change({autoComplete: event.currentTarget.checked})}/>
      Complete when all actions are resolved
    </label>}
    {entry.effective?.blocked && entry.effective.reason && <p>{entry.effective.reason}</p>}
    {!entry.flagged && entry.effective?.flagged && <p>Flag inherited from an ancestor</p>}
  </fieldset>;
}
