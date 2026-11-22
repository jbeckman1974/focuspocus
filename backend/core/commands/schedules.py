"""Apply direct schedule and calendar-setting changes under the workspace lock."""

from django.utils import timezone

from core.scheduling.clock import workspace_clock
from core.scheduling.dates import DateContext, duration_minutes
from core.scheduling.storage import legacy_due_value, merge_schedule, read_schedule

from .state import Changes, save_changed
from .validation import CommandError, fields


def legacy_edit(item, due, context):
    if due == item.due:
        return {}
    typed = {"kind": "date", "value": due.isoformat()} if due is not None else None
    try:
        return {"due": due, "schedule": merge_schedule(read_schedule(item), {"due": typed}, context)}
    except (ValueError, OverflowError) as error:
        raise CommandError(str(error)) from error


def set_schedule(tree, data):
    fields(data, ["ids"], ["schedule", "durationMinutes"])
    if len(data) == 1:
        raise CommandError("Choose a date or estimated duration.")
    items = tree.selected(data["ids"])
    result = Changes([str(item.pk) for item in items])
    context = workspace_clock(tree.workspace)
    try:
        for item in items:
            values = {}
            if "durationMinutes" in data:
                values["duration_minutes"] = duration_minutes(data["durationMinutes"])
            if "schedule" in data:
                schedule = merge_schedule(read_schedule(item), data["schedule"], context)
                values.update(schedule=schedule, due=legacy_due_value(schedule))
            save_changed(item, result, **values)
    except (ValueError, OverflowError) as error:
        raise CommandError(str(error)) from error
    return result


def set_date_settings(tree, data):
    fields(data, optional=["timeZone", "dateDefaults"])
    if not data:
        raise CommandError("Choose a timezone or default clock.")
    workspace = tree.workspace
    zone = data.get("timeZone", workspace.time_zone)
    patch = data.get("dateDefaults", {})
    if not isinstance(patch, dict):
        raise CommandError("Date defaults must be an object.")
    defaults = {**workspace.date_defaults, **patch}
    try:
        DateContext(zone, timezone.now(), defaults)
    except ValueError as error:
        raise CommandError(str(error)) from error
    result = Changes([])
    if (workspace.time_zone, workspace.date_defaults) != (zone, defaults):
        workspace.time_zone, workspace.date_defaults = zone, defaults
        workspace.save(update_fields=["time_zone", "date_defaults"])
        result.versions[str(workspace.pk)] = workspace.revision + 1
    return result
