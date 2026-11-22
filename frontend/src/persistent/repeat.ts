import type { DateField, Schedule } from "./schedule.ts";

export const repeatUnits = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;
export type RepeatUnit = (typeof repeatUnits)[number];
export interface RepeatRule {
  schedule: "regular" | "completion";
  unit: RepeatUnit;
  interval: number;
  anchor?: DateField;
  catchUp?: boolean;
  weekdays?: number[];
  monthDays?: number[];
  ordinal?: { position: number; days: number[] };
  count?: number;
  endDate?: string;
}
export interface Occurrence {
  seriesId: string;
  seriesVersion: number;
  active: boolean;
  rule: RepeatRule;
  remaining: number | null;
  outcome: "open" | "completed" | "dropped" | "skipped";
  resolvedAt?: string | null;
  predecessorId: string | null;
  successorId: string | null;
}
export type RepeatChange =
  | {
      name: "set-repeat";
      payload: { id: string; rule: RepeatRule; seriesVersion?: number };
    }
  | {
      name: "skip-occurrence" | "stop-series";
      payload: { id: string; seriesVersion: number };
    }
  | {
      name: "set-completion-time";
      payload: { id: string; completedAt: string; seriesVersion: number };
    };

export function parseMonthDays(raw: string): number[] {
  const values = raw.split(",").map((v) => v.trim());
  if (
    values.some((v) => !/^(-1|[1-9]|[12][0-9]|3[01])$/.test(v)) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(
      "Choose distinct month days from 1 to 31, or -1 for the last day.",
    );
  }
  return values.map(Number);
}

export function withFrequency(rule: RepeatRule, unit: RepeatUnit) {
  const next = { ...rule, unit };
  if (unit !== "week") delete next.weekdays;
  if (unit !== "month") {
    delete next.monthDays;
    delete next.ordinal;
  }
  return next;
}

export interface RepeatPreviewResult {
  revision: number;
  next: Schedule | null;
  remaining: number | null;
}

export type RepeatPreviewRequest = (
  id: string,
  rule: RepeatRule,
  completedAt: string | undefined,
  signal: AbortSignal,
) => Promise<RepeatPreviewResult>;
