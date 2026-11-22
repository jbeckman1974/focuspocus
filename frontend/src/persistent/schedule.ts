export const dateFields = ["defer", "planned", "due"] as const;
export type DateField = (typeof dateFields)[number];
export type TimeKind = "floating" | "zoned" | "instant";
export interface DateIntent {
  kind: "date" | "floating" | "zoned" | "instant";
  value: string;
  zone?: string;
  fold?: 0 | 1;
  defaultTime?: string;
}
export type Schedule = Partial<Record<DateField, DateIntent | null>>;
export type DateDefaults = Record<DateField, string>;
export interface EffectiveDate {
  value: DateIntent;
  source: string;
  instant: string;
}
export interface DatePreview {
  value: DateIntent;
  instant: string;
  display: string;
  zone: string;
}
export interface DateChanges {
  schedule?: Schedule;
  durationMinutes?: number | null;
}

export function formatCalendarDay(instant: string, timeZone: string) {
  return new Date(instant).toLocaleDateString(undefined, { timeZone });
}

export function describeDate(value: DateIntent | null | undefined) {
  if (!value) return "Unscheduled";
  return [
    value.value,
    value.zone,
    value.kind === "date" ? value.defaultTime : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function previewQuery(
  field: DateField,
  input: string,
  kind: TimeKind,
  zone: string,
  fold: 0 | 1,
  viewZone?: string,
) {
  const query = new URLSearchParams({ field, text: input.trim(), kind });
  if (kind !== "instant") query.set("fold", String(fold));
  if (viewZone) query.set("viewZone", viewZone);
  if (kind === "zoned") query.set("zone", zone);
  return query.toString();
}

export function durationMinutes(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("Enter a whole number of minutes.");
  return Number(value);
}
