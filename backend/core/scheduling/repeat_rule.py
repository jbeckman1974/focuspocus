"""Validate supported editor and storage representations of a repeat series."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from .dates import DAY, FIELDS


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Repetition value is outside the supported range.")
    return value


def selection(data, allowed):
    if not isinstance(data, list) or not 1 <= len(data) <= len(allowed):
        raise ValueError("Choose a nonempty list of calendar positions.")
    if any(type(n) is not int or n not in allowed for n in data) or len(set(data)) != len(data):
        raise ValueError("Unknown or duplicate calendar position.")
    return tuple(sorted(data))


@dataclass(frozen=True)
class RepeatRule:
    schedule: str
    unit: str
    interval: int
    anchor: str | None
    catch_up: bool
    weekdays: tuple
    month_days: tuple
    ordinal: int | None
    ordinal_days: tuple
    end_date: date | None
    count: int | None

    @property
    def restricted(self):
        return bool(self.weekdays or self.month_days or self.ordinal)

    @classmethod
    def from_wire(cls, data):
        names = {"schedule", "unit", "interval", "anchor", "catchUp", "weekdays", "monthDays", "ordinal",
                 "endDate", "count"}
        if not isinstance(data, dict) or set(data) - names:
            raise ValueError("Unknown repeat rule field.")
        schedule, unit = data.get("schedule"), data.get("unit")
        if schedule not in ("regular", "completion") or unit not in ("minute", "hour", "day", "week", "month", "year"):
            raise ValueError("Choose a repeat schedule and unit.")
        interval = integer(data.get("interval", 1), 1, 10_000)
        anchor = data.get("anchor")
        if anchor is not None and anchor not in FIELDS:
            raise ValueError("Choose a defer, planned or due anchor.")
        catch = data.get("catchUp", False)
        if type(catch) is not bool or (catch and schedule == "completion"):
            raise ValueError("Automatic catch-up applies to regular repeats.")
        if ("weekdays" in data and unit != "week") or (
            ("ordinal" in data or "monthDays" in data) and unit != "month"
        ) or ("ordinal" in data and "monthDays" in data):
            raise ValueError("The calendar positions do not match the repeat frequency.")
        weekdays = selection(data["weekdays"], range(7)) if "weekdays" in data else ()
        month_days = selection(data["monthDays"], {-1, *range(1, 32)}) if "monthDays" in data else ()
        ordinal, ordinal_days = None, ()
        if "ordinal" in data:
            pattern = data["ordinal"]
            if not isinstance(pattern, dict) or set(pattern) != {"position", "days"}:
                raise ValueError("Choose an ordinal position and its eligible weekdays.")
            ordinal = pattern["position"]
            if type(ordinal) is not int or ordinal not in {-2, -1, 1, 2, 3, 4, 5}:
                raise ValueError("Unknown ordinal position.")
            ordinal_days = selection(pattern["days"], range(7))
        if "endDate" in data and "count" in data:
            raise ValueError("Choose one repeat ending.")
        end = data.get("endDate")
        if "endDate" in data:
            if not isinstance(end, str) or not re.fullmatch(DAY, end):
                raise ValueError("Use a calendar day for the ending date.")
            end = date.fromisoformat(end)
        count = integer(data["count"], 1, 1_000_000) if "count" in data else None
        return cls(schedule, unit, interval, anchor, catch, weekdays, month_days, ordinal, ordinal_days, end, count)
