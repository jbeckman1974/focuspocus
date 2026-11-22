import type { Snapshot } from "../api.ts";
import type { ItemStatus } from "../rules.ts";
import { dateFields, describeDate, durationMinutes } from "../schedule.ts";
import type { DateField, Schedule } from "../schedule.ts";

export type BulkField =
  "title" | "flagged" | "status" | "durationMinutes" | DateField;
export interface BulkChanges {
  title?: string;
  flagged?: boolean;
  status?: ItemStatus;
  durationMinutes?: number | null;
  schedule?: Schedule;
  tags?: { tagId: string; enabled: boolean }[];
}
export type BulkValues = Record<BulkField, string>;

export const bulkFields: BulkField[] = [
  "title",
  "flagged",
  "status",
  "durationMinutes",
  ...dateFields,
];

function fieldValue(row: Snapshot["tasks"][number], field: BulkField) {
  switch (field) {
    case "title":
      return { input: row.title, label: row.title };
    case "flagged":
      return {
        input: row.flagged ? "yes" : "no",
        label: row.flagged ? "Flagged" : "Unflagged",
      };
    case "status":
      return { input: row.status ?? "active", label: row.status ?? "active" };
    case "durationMinutes":
      return {
        input: row.durationMinutes?.toString() ?? "",
        label:
          row.durationMinutes == null
            ? "No estimate"
            : row.durationMinutes + " min",
      };
    default: {
      const value = row.schedule?.[field];
      const intent = value && value.kind !== "date" ? " · " + value.kind : "";
      const overlap = value?.fold === 1 ? " · second occurrence" : "";
      return {
        input: value?.value.slice(0, 10) ?? "",
        label: describeDate(value) + intent + overlap,
      };
    }
  }
}

export function bulkSelection(rows: Snapshot["tasks"]) {
  const values: BulkValues = {
    title: "",
    flagged: "yes",
    status: "active",
    durationMinutes: "",
    defer: "",
    planned: "",
    due: "",
  };
  const labels = { ...values };
  for (const field of bulkFields) {
    const first = rows[0] && fieldValue(rows[0], field);
    const mixed =
      first && rows.some((row) => fieldValue(row, field).label !== first.label);
    if (first && !mixed) values[field] = first.input;
    labels[field] = mixed ? "Mixed values" : (first?.label ?? "");
  }
  return { values, labels };
}

export function bulkPatch(
  enabled: ReadonlySet<BulkField>,
  values: BulkValues,
  tags: Record<string, string>,
): BulkChanges {
  const patch: BulkChanges = {};
  if (enabled.has("title")) {
    if (!values.title.trim())
      throw new Error("Enter a title for the selection.");
    patch.title = values.title.trim();
  }
  if (enabled.has("flagged")) patch.flagged = values.flagged === "yes";
  if (enabled.has("status")) patch.status = values.status as ItemStatus;
  if (enabled.has("durationMinutes"))
    patch.durationMinutes = durationMinutes(values.durationMinutes);
  for (const field of dateFields) {
    if (enabled.has(field)) {
      patch.schedule ??= {};
      patch.schedule[field] = values[field]
        ? { kind: "date", value: values[field] }
        : null;
    }
  }
  const changedTags = Object.entries(tags).filter(
    ([, choice]) => choice === "add" || choice === "remove",
  );
  if (changedTags.length)
    patch.tags = changedTags.map(([tagId, choice]) => ({
      tagId,
      enabled: choice === "add",
    }));
  return patch;
}
