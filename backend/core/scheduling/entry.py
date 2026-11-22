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
    if kind not in ("floating", "zoned") or (kind == "floating" and zone is not None):
        raise ValueError("Choose floating or a named timezone for local clock input.")
    display_zone = calendar_zone(zone) if kind == "zoned" else context.zone
    text = " ".join(text.strip().lower().split())
    local = re.fullmatch(r"(.+?)(?: at |t| )(" + CLOCK + ")", text)
    day = parse_day(local[1] if local else text, context.now.astimezone(display_zone).date())
    if local:
        stamp = datetime.combine(day, clock_value(local[2]))
        raw = {"kind": kind, "value": stamp.isoformat(timespec="minutes"), "fold": fold}
        if kind == "zoned":
            raw["zone"] = zone
    else:
        raw = {"kind": "date", "value": day.isoformat(), "defaultTime": context.defaults[field].strftime("%H:%M")}
    value = DateIntent.from_wire(raw)
    instant = value.instant(field, context)
    display = instant.astimezone(display_zone if local else context.zone)
    return {"value": value.wire(), "instant": instant.isoformat(), "display": display.isoformat(),
            "zone": (display_zone if local else context.zone).key}
