import { calendarDate } from "../../outline/values.ts";
import type { DateIntent } from "../schedule.ts";

const zoneOffsets = new Map<string, Intl.DateTimeFormat>();

function offsetAt(instant: number, zone: string) {
  if (zone === "UTC") return 0;
  let format = zoneOffsets.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    });
    zoneOffsets.set(zone, format);
  }
  const name = format
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  if (name === "GMT") return 0;
  const offset = /^GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/.exec(name ?? "");
  if (!offset) throw new Error("Cannot resolve this time zone on this device.");
  const seconds =
    Number(offset[2]) * 3600 + Number(offset[3]) * 60 + Number(offset[4] ?? 0);
  return (offset[1] === "-" ? -1 : 1) * seconds * 1000;
}

// An IANA transition can skip a day. Sample both sides of the local wall time,
// then round-trip each candidate to distinguish a gap from a repeated clock.
function wallInstant(wall: number, zone: string, fold = 0) {
  const twoDays = 48 * 60 * 60 * 1000;
  const before = offsetAt(wall - twoDays, zone);
  const after = offsetAt(wall + twoDays, zone);
  if (before === after) return wall - before;
  const candidates = [wall - before, wall - after].sort((a, b) => a - b);
  const matches = candidates.filter(
    (utc) => utc + offsetAt(utc, zone) === wall,
  );
  // Both overlap choices advance a nonexistent clock by the size of the gap.
  return matches.length ? (matches[fold] ?? matches[0]!) : candidates[1]!;
}

const subMilliseconds = (iso: string) =>
  /\.(\d+)/.exec(iso)?.[1].slice(3, 6) ?? "";

export function compareDueInstants(a: string, b: string) {
  return (
    Date.parse(a) - Date.parse(b) ||
    Number(subMilliseconds(a).padEnd(3, "0")) -
      Number(subMilliseconds(b).padEnd(3, "0"))
  );
}

export function dueInstant(
  value: DateIntent,
  viewZone: string,
  defaultTime: string,
) {
  calendarDate(value.kind === "date" ? value.value : value.value.slice(0, 10));
  if (value.kind === "zoned" && !value.zone)
    throw new Error("Choose a time zone for the due date.");
  const offset = /(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const wall =
    value.kind === "date"
      ? value.value + "T" + (value.defaultTime ?? defaultTime)
      : value.value;
  const civil = value.kind === "instant" ? wall.replace(offset, "") : wall;
  if (
    (value.kind === "instant" && civil === wall) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(
      civil,
    )
  )
    throw new Error("Enter a valid timestamp for the due date.");
  const instant =
    value.kind === "instant"
      ? Date.parse(wall)
      : wallInstant(
          Date.parse(wall + "Z"),
          value.kind === "zoned" ? value.zone! : viewZone,
          value.fold,
        );
  const iso = new Date(instant).toISOString();
  if (iso.length !== 24 || iso.startsWith("0000"))
    throw new Error("The due date is outside the calendar.");
  return iso.replace("Z", subMilliseconds(value.value) + "Z");
}
