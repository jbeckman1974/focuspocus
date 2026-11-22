"""Group eligible outline rows under their effective dates in the display zone."""

from datetime import datetime

from core.commands.validation import CommandError, identifier
from core.integrations.calendars import add_to_forecast
from core.queries.outline import tag_scope
from core.queries.records import read_records
from core.queries.views import view_zone
from core.scheduling.clock import workspace_clock

from .sections import forecast_days
from .calendar import allow_options, boolean, calendar_day, local_today, next_midnight


def forecast(workspace, user, params):
    from core.perspectives.focus import focused_ids

    allow_options(params, {"start", "days", "layout", "planned", "deferred", "flagged",
                           "tagId", "viewZone", "includeHeld"})
    clock = workspace_clock(workspace, view_zone=view_zone(params))
    today = local_today(clock)
    start = calendar_day(params["start"]) if "start" in params else today
    days = params.get("days", "7")
    if not days.isascii() or not days.isdecimal() or len(days) > 2 or not 1 <= int(days) <= 62:
        raise CommandError("Choose a Forecast range from 1 to 62 days.", 400)
    if start.toordinal() + int(days) - 1 > start.max.toordinal():
        raise CommandError("Forecast range extends beyond the supported calendar.", 400)
    layout = params.get("layout", "grouped")
    if layout not in ("grouped", "combined"):
        raise CommandError("Choose grouped or combined Forecast.", 400)
    enabled = ["due"]
    if boolean(params, "planned", True):
        enabled.append("planned")
    if boolean(params, "deferred"):
        enabled.append("defer")
    flagged, held = boolean(params, "flagged"), boolean(params, "includeHeld")
    rows, tags, metadata = read_records(workspace, clock=clock)
    tag = str(identifier(params["tagId"])) if "tagId" in params else None
    day_rows, matches = forecast_days(
        rows, clock=clock, start=start, days=int(days), enabled_dates=enabled, flagged=flagged,
        tags=tag_scope(tags, tag) if tag else set(), layout=layout, include_held=held,
        focus=focused_ids(workspace, user, rows),
    )
    add_to_forecast(day_rows, workspace, user, clock.zone)
    boundary = next_midnight(clock)
    if metadata["nextDateBoundary"]:
        boundary = min(boundary, datetime.fromisoformat(metadata["nextDateBoundary"]))
    return {"workspaceId": str(workspace.pk), "revision": workspace.revision, "today": today.isoformat(),
            "viewZone": clock.zone.key, "nextDateBoundary": boundary.isoformat(), "layout": layout,
            "days": day_rows, "rows": matches}
