"""Bounded read-only iCalendar snapshots. External records keep provider identities."""

import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .calendar_rules import duration, occurrences
from .configuration import AdapterError


MAX_BYTES = 1024 * 1024
MAX_EVENTS = 1500
PROPERTIES = {"UID", "SUMMARY", "SEQUENCE", "STATUS", "RECURRENCE-ID", "DTSTART", "DTEND",
              "RRULE", "RDATE", "EXRULE", "EXDATE", "DURATION"}


def stamp(raw, params, zone):
    all_day = params.get("VALUE") == "DATE" or (len(raw) == 8 and raw.isdigit())
    try:
        if all_day:
            return datetime.strptime(raw, "%Y%m%d").date()
        when = datetime.strptime(raw.removesuffix("Z"), "%Y%m%dT%H%M%S")
        tz = timezone.utc if raw.endswith("Z") else ZoneInfo(params.get("TZID", zone))
        return when.replace(tzinfo=tz)
    except (ValueError, OverflowError, ZoneInfoNotFoundError) as exc:
        raise AdapterError("calendar_date_invalid") from exc


def iso(value):
    return (value.astimezone(timezone.utc) if isinstance(value, datetime) else value).isoformat()


def id_for(uid, instance):
    return hashlib.sha256((uid + "\x00" + instance).encode()).hexdigest()


def raw_blocks(data):
    if len(data) > MAX_BYTES:
        raise AdapterError("calendar_too_large")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError as exc:
        raise AdapterError("calendar_format_invalid") from exc
    if any(ord(c) < 32 and c not in "\t\r\n" for c in text):
        raise AdapterError("calendar_format_invalid")
    lines = re.sub(r"\r?\n[ \t]", "", text).strip().splitlines()
    if not lines or lines[0].upper() != "BEGIN:VCALENDAR" or lines[-1].upper() != "END:VCALENDAR":
        raise AdapterError("calendar_format_invalid")
    stack, props, count = [], None, 0
    for line in lines:
        if not line:
            continue
        key, separator, value = line.partition(":")
        if not separator or len(line) > 8192:
            raise AdapterError("calendar_format_invalid")
        attr, *params = key.split(";")
        name = attr.upper()
        if name == "BEGIN":
            component = value.upper()
            if component == "VEVENT":
                if stack != ["VCALENDAR"]:
                    raise AdapterError("calendar_format_invalid")
                props = {}
            stack.append(component)
            if len(stack) > 8:
                raise AdapterError("calendar_format_invalid")
        elif name == "END":
            if not stack or stack.pop() != value.upper():
                raise AdapterError("calendar_format_invalid")
            if value.upper() == "VEVENT":
                count += 1
                if count > MAX_EVENTS:
                    raise AdapterError("calendar_too_large")
                yield props
                props = None
        elif props is not None and stack[-1] == "VEVENT" and name in PROPERTIES:
            options = dict(part.split("=", 1) for part in params if "=" in part)
            datum = {k.upper(): v.strip('"') for k, v in options.items()}, value
            if name in ("RDATE", "EXDATE"):
                props.setdefault(name, []).append(datum)
            elif name in props:
                raise AdapterError("calendar_format_invalid")
            else:
                props[name] = datum
    if stack:
        raise AdapterError("calendar_format_invalid")


def series_blocks(data, zone):
    groups = {}
    for props in raw_blocks(data):
        uid = props.get("UID", ({}, ""))[1]
        if not uid or len(uid) > 1024:
            raise AdapterError("calendar_identity_invalid")
        group = groups.setdefault(uid, {})
        instance = ""
        if "RECURRENCE-ID" in props:
            params, raw = props["RECURRENCE-ID"]
            if "RANGE" in params:
                raise AdapterError("calendar_requires_expanded_events")
            instance = iso(stamp(raw, params, zone))
        raw_seq = props.get("SEQUENCE", ({}, "0"))[1]
        if not re.fullmatch(r"\d{1,9}", raw_seq, re.ASCII):
            raise AdapterError("calendar_sequence_invalid")
        if instance not in group or int(raw_seq) >= group[instance][0]:
            group[instance] = int(raw_seq), props
    return groups


def dates(props, name, zone):
    for params, values in props.get(name, []):
        for raw in values.split(","):
            yield stamp(raw, params, zone)


def expand(uid, instance, props, zone, today):
    if props.get("STATUS", ({}, ""))[1].upper() == "CANCELLED":
        return {}
    params, raw = props.get("DTSTART", ({}, ""))
    start = stamp(raw, params, zone)
    all_day = type(start) is date
    span = timedelta(days=int(all_day))
    if "DTEND" in props:
        end_params, end_raw = props["DTEND"]
        end = stamp(end_raw, end_params, zone)
        if type(end) != type(start) or end < start or (all_day and end == start):
            raise AdapterError("calendar_date_invalid")
        span = end - start
    elif "DURATION" in props:
        span = duration(props["DURATION"][1])
        if all_day and (span.seconds or span.days < 1):
            raise AdapterError("calendar_duration_invalid")
    if "EXRULE" in props or ("DTEND" in props and "DURATION" in props):
        raise AdapterError("calendar_requires_expanded_events")
    summary = props.get("SUMMARY", ({}, "Calendar event"))[1]
    title = re.sub(r"\\([nN,;\\])", lambda m: " " if m[1] in "nN" else m[1], summary)
    if len(title) > 512:
        raise AdapterError("calendar_title_too_long")
    repeating = bool({"RRULE", "RDATE", "EXDATE"}.intersection(props))
    if instance and repeating:
        raise AdapterError("calendar_requires_expanded_events")
    starts = {start}
    if "RRULE" in props:
        starts.update(occurrences(props["RRULE"][1], start, today, stamp))
    starts.update(dates(props, "RDATE", zone))
    starts.difference_update(dates(props, "EXDATE", zone))
    entries = {}
    for when in starts:
        if type(when) != type(start):
            raise AdapterError("calendar_date_invalid")
        logical = instance or (iso(when) if repeating else "")
        entries[logical] = dict(key=id_for(uid, logical), title=title or "Calendar event",
                                all_day=all_day, start=iso(when), end=iso(when + span))
    return entries


def parse(data, zone="UTC", *, today=None):
    today = today or datetime.now(timezone.utc).date()
    result, series_count = [], 0
    try:
        for uid, group in series_blocks(data, zone).items():
            master = group.pop("", (0, {}))[1]
            if master.get("STATUS", ({}, ""))[1].upper() == "CANCELLED":
                continue
            if "RRULE" in master:
                series_count += 1
                if series_count > 64:
                    raise AdapterError("calendar_too_large")
            items = expand(uid, "", master, zone, today) if master else {}
            for instance, (_, props) in group.items():
                items.pop(instance, None)
                items.update(expand(uid, instance, props, zone, today))
            result.extend(items.values())
            if len(result) > MAX_EVENTS:
                raise AdapterError("calendar_too_large")
    except (ValueError, OverflowError) as exc:
        raise AdapterError("calendar_date_invalid") from exc
    return result
