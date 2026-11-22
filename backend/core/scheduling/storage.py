"""Keep the legacy date-only due field interoperable with structured schedules."""

from datetime import date, datetime, timezone

from .dates import DateIntent, direct_dates


def read_schedule(item):
    direct = dict(item.schedule)
    if item.due is not None and "due" not in direct:
        direct["due"] = {"kind": "date", "value": item.due.isoformat()}
    return direct


def legacy_due_value(schedule):
    if "due" not in schedule:
        return None
    intent = DateIntent.from_wire(schedule["due"])
    if intent.kind == "instant":
        return datetime.fromisoformat(intent.value.replace("Z", "+00:00")).astimezone(timezone.utc).date()
    return date.fromisoformat(intent.value[:10])


def merge_schedule(current, patch, context):
    validated = direct_dates(patch)
    updated = {key: value for key, value in current.items() if key not in patch}
    for field, intent in validated.items():
        wire = intent.wire()
        if intent.kind == "date" and "defaultTime" not in wire:
            wire["defaultTime"] = context.defaults[field].strftime("%H:%M")
        # Resolve against the configured clock too. Reject calendar extremes that
        # cannot be represented in UTC before persisting them.
        DateIntent.from_wire(wire).instant(field, context)
        updated[field] = wire
    return updated
