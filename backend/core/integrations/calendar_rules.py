"""Bounded calendar-feed recurrence expansion in the event's original timezone."""

import re
from datetime import date, datetime, time, timedelta, timezone

from .configuration import AdapterError


def duration(value):
    match = re.fullmatch(r"P(?:(\d{1,3})W|(?:(\d{1,3})D)?(?:T(?:(\d{1,3})H)?(?:(\d{1,3})M)?(?:(\d{1,3})S)?)?)", value)
    if not match or not any(match.groups()):
        raise AdapterError("calendar_duration_invalid")
    weeks, days, hours, minutes, seconds = (int(v or 0) for v in match.groups())
    return timedelta(weeks=weeks, days=days, hours=hours, minutes=minutes, seconds=seconds)


def numbers(parts, key, minimum, maximum):
    if key not in parts:
        return None
    entries = parts[key].split(",")
    if len(entries) > 62 or not all(re.fullmatch(r"[+-]?\d{1,3}", x) for x in entries):
        raise AdapterError("calendar_recurrence_invalid")
    found = tuple(int(x) for x in entries)
    if any(x == 0 or not minimum <= x <= maximum for x in found):
        raise AdapterError("calendar_recurrence_invalid")
    return found


def occurrences(rule, start, today, stamp):
    from dateutil import rrule

    fields = rule.split(";")
    if len(fields) > 10 or any("=" not in p for p in fields):
        raise AdapterError("calendar_recurrence_invalid")
    parts = dict(p.split("=", 1) for p in fields)
    if len(parts) != len(fields) or set(parts) - {
            "FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTH", "BYMONTHDAY", "BYSETPOS", "WKST"}:
        raise AdapterError("calendar_requires_expanded_events")
    frequency = parts.get("FREQ")
    if frequency not in ("DAILY", "WEEKLY", "MONTHLY", "YEARLY"):
        raise AdapterError("calendar_requires_expanded_events")
    all_day = type(start) is date
    origin = datetime.combine(start, time.min, timezone.utc) if all_day else start
    if origin.year < today.year - 25:
        raise AdapterError("calendar_requires_expanded_events")
    through = datetime.combine(today + timedelta(days=366), time.max, origin.tzinfo)
    if "UNTIL" in parts:
        raw = parts["UNTIL"]
        until = stamp(raw, {}, "UTC")
        if type(until) is date:
            until = datetime.combine(until, time.max, origin.tzinfo)
        through = min(through, until)
    interval, count = parts.get("INTERVAL", "1"), parts.get("COUNT", "999999")
    if not re.fullmatch(r"[1-9]\d{0,3}", interval) or not re.fullmatch(r"[1-9]\d{0,5}", count):
        raise AdapterError("calendar_recurrence_invalid")
    days = {key:getattr(rrule, key) for key in ("MO", "TU", "WE", "TH", "FR", "SA", "SU")}
    byday = []
    if "BYDAY" in parts:
        labels = parts["BYDAY"].split(",")
        if len(labels) > 35:
            raise AdapterError("calendar_recurrence_invalid")
        for label in labels:
            group = re.fullmatch(r"([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)", label)
            if not group:
                raise AdapterError("calendar_recurrence_invalid")
            weekday = days[group[2]]
            byday.append(weekday(int(group[1])) if group[1] else weekday)
    if parts.get("WKST","MO") not in days:
        raise AdapterError("calendar_recurrence_invalid")
    iterator = rrule.rrule(getattr(rrule, frequency), dtstart=origin, until=through, interval=int(interval),
                           byweekday=byday or None, wkst=days[parts.get("WKST", "MO")],
                           bymonth=numbers(parts, "BYMONTH", 1, 12), bymonthday=numbers(parts, "BYMONTHDAY", -31, 31),
                           bysetpos=numbers(parts, "BYSETPOS", -366, 366))
    floor = today - timedelta(days=62)
    for index, value in enumerate(iterator):
        if index >= int(count):
            break
        if value.date() >= floor:
            yield value.date() if all_day else value
