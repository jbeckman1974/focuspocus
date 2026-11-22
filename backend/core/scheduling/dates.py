"""Resolve assigned dates without losing their calendar or timezone intent."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from types import MappingProxyType
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


UTC = timezone.utc
FIELDS = ("defer", "planned", "due")
MAX_DURATION_MINUTES = 5_259_600
DEFAULT_TIMES = {"defer": "00:00", "planned": "00:00", "due": "17:00"}
DAY = r"[0-9]{4}-[0-9]{2}-[0-9]{2}"
CLOCK = r"(?:[01][0-9]|2[0-3]):[0-5][0-9]"
LOCAL = DAY + "T" + CLOCK + r"(?::[0-5][0-9](?:\.[0-9]{1,6})?)?"


def calendar_zone(name):
    if not isinstance(name, str) or len(name) > 128:
        raise ValueError("Choose an IANA timezone.")
    try:
        return ZoneInfo(name)
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise ValueError("Choose an IANA timezone.") from error


def clock_value(value):
    if not isinstance(value, str) or not re.fullmatch(CLOCK, value):
        raise ValueError("Use a 24-hour clock time in HH:MM form.")
    return time.fromisoformat(value)


class DateContext:
    """One evaluation uses one instant, one view zone and explicit default clocks."""

    def __init__(self, zone, now, defaults=None):
        self.zone = zone if isinstance(zone, ZoneInfo) else calendar_zone(zone)
        if not isinstance(now, datetime) or now.utcoffset() is None:
            raise ValueError("Evaluation requires an aware clock.")
        self.now = now.astimezone(UTC)
        if defaults is not None and (not isinstance(defaults, dict) or set(defaults) - set(FIELDS)):
            raise ValueError("Unknown default clock field.")
        clocks = {**DEFAULT_TIMES, **(defaults or {})}
        self.defaults = MappingProxyType({key: clock_value(value) for key, value in clocks.items()})


def wall_instant(local, zone, fold=0):
    """Choose an overlap side; in a gap move forward by the transition size."""
    # Round-trip through UTC to distinguish nonexistent clocks from overlaps.
    chosen = local.replace(tzinfo=zone, fold=fold).astimezone(UTC)
    projected = chosen.astimezone(zone).replace(tzinfo=None)
    if projected < local:
        return local.replace(tzinfo=zone, fold=1-fold).astimezone(UTC)
    return chosen


@dataclass(frozen=True)
class DateIntent:
    kind: str
    value: str
    zone: str | None = None
    fold: int = 0
    default_time: str | None = None

    @classmethod
    def from_wire(cls, raw):
        if not isinstance(raw, dict) or not {"kind", "value"} <= raw.keys():
            raise ValueError("Specify the date kind and value.")
        kind, value = raw["kind"], raw["value"]
        extras = {"date": {"defaultTime"}, "floating": {"fold"}, "zoned": {"zone", "fold"}, "instant": set()}
        if not isinstance(kind, str) or kind not in extras or set(raw) - {"kind", "value"} - extras[kind]:
            raise ValueError("Invalid fields for this date kind.")
        if not isinstance(value, str) or len(value) > 40:
            raise ValueError("Use an ISO date or timestamp.")
        fold = raw.get("fold", 0)
        if type(fold) is not int or fold not in (0, 1):
            raise ValueError("The overlap choice must be 0 or 1.")
        if "defaultTime" in raw:
            clock_value(raw["defaultTime"])
        if kind == "zoned":
            calendar_zone(raw.get("zone"))
        if kind == "date":
            if not re.fullmatch(DAY, value):
                raise ValueError("Use YYYY-MM-DD for a calendar day.")
            date.fromisoformat(value)
        else:
            pattern = LOCAL + (r"(?:Z|[+-]" + CLOCK + ")" if kind == "instant" else "")
            if not re.fullmatch(pattern, value):
                raise ValueError("Use an ISO timestamp with an offset only for fixed instants.")
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        return cls(kind, value, raw.get("zone"), fold, raw.get("defaultTime"))

    def wire(self):
        value = {"kind": self.kind, "value": self.value}
        if self.zone is not None:
            value["zone"] = self.zone
        if self.fold:
            value["fold"] = self.fold
        if self.default_time is not None:
            value["defaultTime"] = self.default_time
        return value

    def instant(self, field, context):
        if field not in FIELDS:
            raise ValueError("Unknown schedule field.")
        if self.kind == "date":
            day = date.fromisoformat(self.value)
            clock = clock_value(self.default_time) if self.default_time else context.defaults[field]
            return wall_instant(datetime.combine(day, clock), context.zone)
        stamp = datetime.fromisoformat(self.value.replace("Z", "+00:00"))
        if self.kind == "instant":
            return stamp.astimezone(UTC)
        zone = calendar_zone(self.zone) if self.kind == "zoned" else context.zone
        return wall_instant(stamp, zone, self.fold)


@dataclass(frozen=True)
class SourcedDate:
    value: DateIntent
    source: str
    instant: datetime

    def wire(self):
        return {"value": self.value.wire(), "source": str(self.source), "instant": self.instant.isoformat()}


def direct_dates(data):
    if not isinstance(data, dict) or set(data) - set(FIELDS):
        raise ValueError("Schedule fields are defer, planned and due.")
    return {key: DateIntent.from_wire(value) for key, value in data.items() if value is not None}


def effective_dates(item_id, direct, inherited, context):
    result = dict(inherited)
    for field, value in direct.items():
        if not isinstance(value, DateIntent):
            value = DateIntent.from_wire(value)
        candidate = SourcedDate(value, item_id, value.instant(field, context))
        previous = result.get(field)
        if previous and (
            (field == "defer" and candidate.instant < previous.instant)
            or (field == "due" and candidate.instant > previous.instant)
        ):
            continue
        result[field] = candidate
    return result


def next_date_boundary(effective, context):
    return min((entry.instant for entry in effective.values() if entry.instant > context.now), default=None)


def duration_minutes(value):
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= MAX_DURATION_MINUTES:
        raise ValueError("Duration must be a whole number of minutes between zero and ten years.")
    return value
