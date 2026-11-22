"""Plan the next occurrence from a stored rule, an origin and a completed occurrence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .calendar_slots import date_slots
from .dates import UTC, DateIntent, calendar_zone, direct_dates, wall_instant
from .repeat_rule import RepeatRule, integer


@dataclass(frozen=True)
class NextOccurrence:
    schedule: dict
    remaining: int | None


def clock_zone(intent, context):
    if intent.kind == "zoned":
        return calendar_zone(intent.zone)
    if intent.kind == "instant":
        return UTC
    return context.zone


def as_intent(template, instant, context):
    local = instant.astimezone(clock_zone(template, context))
    if template.kind == "date":
        return DateIntent("date", local.date().isoformat(), default_time=template.default_time)
    if template.kind == "instant":
        return DateIntent("instant", instant.astimezone(UTC).isoformat())
    # Retain seconds on a fractional/second-precision source, and on a
    # generated time that could not be represented exactly in minutes.
    seconds = local.second or local.microsecond or len(template.value) > 16
    precision = "microseconds" if local.microsecond else ("seconds" if seconds else "minutes")
    return DateIntent(template.kind, local.replace(tzinfo=None).isoformat(timespec=precision),
                      zone=template.zone, fold=local.fold)


def subday_slot(rule, source, threshold, completed, zone):
    step = timedelta(**{rule.unit + "s": rule.interval})
    if rule.schedule == "regular":
        intervals = max(1, (threshold - source) // step + 1)
        return source + step * intervals
    local = completed.astimezone(zone)
    if rule.unit == "hour":
        rounded = local.replace(minute=0, second=0, microsecond=0)
        round_up = local.minute >= 30
        bucket = timedelta(hours=1)
    else:
        rounded = local.replace(second=0, microsecond=0)
        round_up = local.second >= 30
        bucket = timedelta(minutes=1)
    baseline = rounded.astimezone(UTC) + (bucket if round_up else timedelta())
    return baseline + step


def calendar_slot(rule, seed, authored, threshold, completed, zone):
    original = seed.astimezone(zone)
    clock = original.time().replace(tzinfo=None)
    if authored.kind in ("zoned", "floating"):
        clock = datetime.fromisoformat(authored.value).time()
    origin = original.date()
    floor = threshold.astimezone(zone).date()
    if rule.schedule == "completion":
        origin = completed.astimezone(zone).date()
        # Complete the current slot before looking for a later calendar day.
        floor = origin + timedelta(days=1)
    for day in date_slots(rule, origin, floor):
        local = datetime.combine(day, clock)
        instant = wall_instant(local, zone, original.fold)
        if instant > threshold:
            return instant
    return None


def anchor_field(rule, current):
    if not current:
        raise ValueError("Assign a date before configuring a repeat.")
    preferred = next(key for key in ("due", "planned", "defer") if key in current)
    anchor = (rule.anchor or preferred) if rule.restricted or rule.schedule == "completion" else preferred
    if anchor not in current:
        raise ValueError("The selected repeat anchor requires an assigned date.")
    return anchor


def next_occurrence(rule, schedule, context, *, completed_at=None, origin=None, remaining=None, skip=False):
    """Return the successor's assigned dates and remaining count, or end the series.

    The caller persists the initial origin across occurrences to retain the
    intended day for month-end and leap-day series, including after a clamp.
    """
    if not isinstance(rule, RepeatRule):
        rule = RepeatRule.from_wire(rule)
    current = direct_dates(schedule)
    initial = direct_dates(origin) if origin is not None else current
    anchor = anchor_field(rule, current)
    if anchor not in initial:
        raise ValueError("The selected repeat anchor requires an assigned date.")
    if remaining is None:
        remaining = rule.count
    if remaining is not None:
        integer(remaining, 1, 1_000_000)
        remaining -= int(not skip)
        if remaining == 0:
            return None
    completed = completed_at if completed_at is not None else context.now
    if not isinstance(completed, datetime) or completed.utcoffset() is None:
        raise ValueError("The completion clock requires an explicit timezone.")
    completed = completed.astimezone(UTC)
    old = current[anchor].instant(anchor, context)
    seed = initial[anchor].instant(anchor, context)
    zone = clock_zone(current[anchor], context)
    threshold = completed if rule.schedule == "completion" else old
    if rule.catch_up:
        threshold = max(old, completed)
    subday = rule.unit in ("minute", "hour")
    if subday and any(value.kind == "date" for value in current.values()):
        raise ValueError("Assign explicit times for sub-day repeats.")
    try:
        if subday:
            new = subday_slot(rule, seed, threshold, completed, zone)
        else:
            new = calendar_slot(rule, seed, initial[anchor], threshold, completed, zone)
        if new is None or (rule.end_date and new.astimezone(zone).date() > rule.end_date):
            return None
        elapsed = new - old
        wall_delta = new.astimezone(zone).replace(tzinfo=None) - old.astimezone(zone).replace(tzinfo=None)
        result = {}
        for field, value in current.items():
            previous = value.instant(field, context)
            if field == anchor or subday:
                target = previous + elapsed
            else:
                field_zone = clock_zone(value, context)
                wall = previous.astimezone(field_zone).replace(tzinfo=None) + wall_delta
                target = wall_instant(wall, field_zone, value.fold)
            result[field] = as_intent(value, target, context).wire()
        return NextOccurrence(result, remaining)
    except OverflowError:
        # There is no representable calendar occurrence after the year limit.
        return None
