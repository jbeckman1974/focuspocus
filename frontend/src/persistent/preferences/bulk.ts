import type { ItemStatus } from "../rules.ts";
import { dateFields, durationMinutes } from "../schedule.ts";
import type { DateField, Schedule } from "../schedule.ts";

export type BulkField = "title" | "flagged" | "status" | "durationMinutes" | DateField;
export interface BulkChanges {
  title?: string;
  flagged?: boolean;
  status?: ItemStatus;
  durationMinutes?: number | null;
  schedule?: Schedule;
  tags?: { tagId: string; enabled: boolean }[];
}
export type BulkValues = Record<BulkField, string>;

export function bulkPatch(enabled: ReadonlySet<BulkField>, values: BulkValues, tags: Record<string, string>): BulkChanges {
  const patch: BulkChanges = {};
  if (enabled.has("title")) {
    if (!values.title.trim()) throw new Error("Enter a title for the selection.");
    patch.title = values.title.trim();
  }
  if (enabled.has("flagged")) patch.flagged = values.flagged === "yes";
  if (enabled.has("status")) patch.status = values.status as ItemStatus;
  if (enabled.has("durationMinutes")) patch.durationMinutes = durationMinutes(values.durationMinutes);
  for (const field of dateFields) {
    if (enabled.has(field)) {
      patch.schedule ??= {};
      patch.schedule[field] = values[field] ? { kind: "date", value: values[field] } : null;
    }
  }
  const changedTags = Object.entries(tags).filter(([, choice]) => choice === "add" || choice === "remove");
  if (changedTags.length) patch.tags = changedTags.map(([tagId, choice]) => ({ tagId, enabled: choice === "add" }));
  return patch;
}
