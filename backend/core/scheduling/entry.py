"""Preview bounded English date entry with the exact timestamp the server will use."""

import re
from datetime import date, datetime, timedelta

from .dates import CLOCK, DAY, FIELDS, DateIntent, calendar_zone, clock_value


WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def parse_day(text, today):
    if re.fullmatch(DAY, text):
        return date.fromisoformat(text)
    if text in ("yesterday", "today", "tomorrow"):
        return today + timedelta(days={"yesterday": -1, "today": 0, "tomorrow": 1}[text])
    relative = re.fullmatch(r"in ([0-9]{1,4}) (days?|weeks?)", text)
    if relative:
        days = int(relative[1]) * (7 if relative[2].startswith("week") else 1)
        return today + timedelta(days=days)
    if text.startswith("next ") and text[5:] in WEEKDAYS:
        offset = (WEEKDAYS.index(text[5:]) - today.weekday()) % 7
        return today + timedelta(days=offset or 7)
    raise ValueError("Use an ISO date, today, tomorrow, yesterday, next weekday or in N days/weeks.")


def preview_entry(text, field, context, kind="floating", zone=None, fold=0):
    if not isinstance(text, str) or len(text) > 80 or field not in FIELDS:
        raise ValueError("Enter a short date expression for a schedule field.")
    if kind not in ("date", "floating", "zoned", "instant") or (kind != "zoned" and zone is not None):
        raise ValueError("Choose a date intent and an IANA zone only for zoned input.")
    if kind == "instant":
        intent = DateIntent.from_wire({"kind": "instant", "value": text.strip()})
        return interpreted(intent, field, context, context.zone)
    display_zone = calendar_zone(zone) if kind == "zoned" else context.zone
    text = " ".join(text.strip().lower().split())
    local = re.fullmatch(r"(.+?)(?: at |t| )(" + CLOCK + ")", text)
    if local and kind == "date":
        raise ValueError("Choose a time-bearing intent for an explicit clock.")
    if not local:
        display_zone = context.zone
    day = parse_day(local[1] if local else text, context.now.astimezone(display_zone).date())
    if local:
        stamp = datetime.combine(day, clock_value(local[2]))
        raw = {"kind": kind, "value": stamp.isoformat(timespec="minutes"), "fold": fold}
        if kind == "zoned":
            raw["zone"] = zone
    else:
        raw = {"kind": "date", "value": day.isoformat(), "defaultTime": context.defaults[field].strftime("%H:%M")}
    return interpreted(DateIntent.from_wire(raw), field, context, display_zone)


def interpreted(value, field, context, display_zone):
    instant = value.instant(field, context)
    return {
        "value": value.wire(), "instant": instant.isoformat(),
        "display": instant.astimezone(display_zone).isoformat(), "zone": display_zone.key,
    }
