"""Serialize one scoped set of items for the snapshot and filtered projections."""

from core.repeats.read import repeat_states
from core.rules.projection import evaluate_rows
from core.scheduling.clock import workspace_clock
from .calendar import schedules_for
from .items import direct_rows, iso, read_tags


def read_records(workspace, view_zone=None, *, clock=None):
    clock = clock or workspace_clock(workspace, view_zone=view_zone)
    tags, by_item = read_tags(workspace)
    rows = direct_rows(workspace, by_item)
    repeats = repeat_states(workspace)
    dates, defer, boundary = schedules_for(rows, clock)
    held = {tag["id"] for tag in tags if tag["status"] == "held"}
    effective = evaluate_rows(rows, held, now=clock.now, direct_defer=defer)
    for row in rows:
        key = row["id"]
        value = effective[key]
        row["effective"] = {
            "schedule": dates[key],
            "status": value.status, "statusSource": value.status_source,
            "flagged": value.flagged, "flagSource": value.flag_source,
            "remaining": value.remaining, "available": value.available,
            "firstAvailable": value.first_available, "blocked": value.blocked,
            "reason": value.reason, "reasonSource": value.reason_source,
        }
        row["repeat"] = repeats.get(key)
    metadata = {
        "timeZone": workspace.time_zone, "viewZone": clock.zone.key,
        "dateDefaults": {field: value.strftime("%H:%M") for field, value in clock.defaults.items()},
        "nextDateBoundary": iso(boundary),
    }
    return rows, tags, metadata
