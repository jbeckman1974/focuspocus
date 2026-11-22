import { useLayoutEffect, useRef, useState } from "react";
import type { Snapshot } from "../api.ts";
import type { WorkspaceChannel } from "../channel.ts";
import { dateFields, describeDate } from "../schedule.ts";
import { bulkPatch } from "./bulk.ts";
import type { BulkChanges, BulkField, BulkValues } from "./bulk.ts";

interface Props {
  snapshot: Snapshot;
  ids: string[];
  channel: WorkspaceChannel;
  disabled: boolean;
}
const labels: Record<BulkField, string> = {
  title: "Title", flagged: "Flag", status: "Status", durationMinutes: "Duration",
  defer: "Defer", planned: "Planned", due: "Due",
};
const fields: BulkField[] = ["title", "flagged", "status", "durationMinutes", ...dateFields];

function BulkDialog({ base, ids, submit, close }: {
  base: Snapshot; ids: string[]; submit: (patch: BulkChanges) => boolean; close: () => void;
}) {
  const rows = base.tasks.filter((row) => ids.includes(row.id));
  const [enabled, setEnabled] = useState<Set<BulkField>>(new Set());
  const [values, setValues] = useState<BulkValues>({
    title: "", flagged: "yes", status: "active", durationMinutes: "", defer: "", planned: "", due: "",
  });
  const [tags, setTags] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function summary(field: BulkField) {
    const entries = new Set(rows.map((row) => {
      switch (field) {
        case "flagged": return row.flagged ? "Flagged" : "Unflagged";
        case "status": return row.status ?? "active";
        case "durationMinutes": return row.durationMinutes == null ? "No estimate" : row.durationMinutes + " min";
        case "title": return row.title;
        default: return describeDate(row.schedule?.[field]);
      }
    }));
    return entries.size > 1 ? "Mixed values" : [...entries][0];
  }
  const update = (field: BulkField, value: string) => setValues({ ...values, [field]: value });
  function save() {
    try {
      const patch = bulkPatch(enabled, values, tags);
      if (!Object.keys(patch).length) return setMessage("Choose a field or tag to change.");
      if (submit(patch)) close();
      else setMessage("Finish the pending write before applying these changes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Check the selected values."); }
  }
  return <dialog ref={dialog} className="fp-dialog" aria-label="Edit selected items" onCancel={close}>
    <h2>Edit selected items</h2>
    <form onSubmit={(event) => { event.preventDefault(); save(); }}>
      {fields.map((field) => <div key={field} className="fp-dialog-fields">
        <label><input type="checkbox" aria-label={"Change " + labels[field].toLowerCase()}
          checked={enabled.has(field)} onChange={(event) => {
            const next = new Set(enabled);
            if (event.target.checked) next.add(field); else next.delete(field);
            setEnabled(next);
          }} /> {labels[field]} <small>{summary(field)}</small></label>
        {enabled.has(field) && (field === "flagged" || field === "status" ?
          <select aria-label={labels[field]} value={values[field]} onChange={(e) => update(field, e.target.value)}>
            {field === "flagged" ? <><option value="yes">Flagged</option><option value="no">Unflagged</option></> :
              ["active", "completed", "dropped"].map((status) => <option key={status}>{status}</option>)}
          </select> :
          <input aria-label={labels[field]} type={field === "title" ? "text" : field === "durationMinutes" ? "number" : "date"}
            min={field === "durationMinutes" ? 0 : undefined} value={values[field]} onChange={(e) => update(field, e.target.value)} />
        )}
      </div>)}
      {base.tags.length > 0 && <fieldset><legend>Direct tags</legend>
        {base.tags.map((tag) => {
          const count = rows.filter((row) => row.tags.includes(tag.id)).length;
          return <label key={tag.id}>{tag.title} <small>{count === 0 ? "None" : count === rows.length ? "All selected" : "Mixed values"}</small>
            <select aria-label={tag.title} value={tags[tag.id] ?? ""} onChange={(e) => setTags({ ...tags, [tag.id]: e.target.value })}>
              <option value="">Keep current</option><option value="add">Apply</option><option value="remove">Remove</option>
            </select>
          </label>;
        })}
      </fieldset>}
      {message && <p role="alert">{message}</p>}
      <button type="submit">Apply to selection</button><button type="button" onClick={close}>Cancel</button>
    </form>
  </dialog>;
}

export function BulkInspector({ snapshot, ids, channel, disabled }: Props) {
  const [draft, setDraft] = useState<{ base: Snapshot; ids: string[] }>();
  return <>
    <button disabled={disabled} onClick={() => setDraft({ base: snapshot, ids: [...ids] })}>Bulk edit…</button>
    {draft && <BulkDialog base={draft.base} ids={draft.ids} close={() => setDraft(undefined)}
      submit={(changes) => channel.run({ type: "bulk-inspect", ids: draft.ids, changes }, draft.base)} />}
  </>;
}
