"""Group eligible outline rows under their effective dates in the display zone."""

from collections import defaultdict
from datetime import datetime, timedelta

from core.commands.validation import CommandError, identifier
from core.queries.outline import tag_scope, tree_order
from core.queries.records import read_records
from core.queries.views import view_zone
from core.scheduling.clock import workspace_clock

from .calendar import allow_options, boolean, calendar_day, local_today, next_midnight


SECTIONS = ("due", "planned", "deferred", "tagged", "flagged")


def forecast_days(rows, *, clock, start, days, enabled_dates, flagged, tags, layout, include_held, focus=None):
    today = local_today(clock)
    buckets = {start + timedelta(days=offset): defaultdict(list) for offset in range(days)}
    matched = []
    held = {row["id"] for row in rows if row["kind"] == "project" and row["status"] == "held"}
    for row, _, project, _ in tree_order(rows, None):
        if focus is not None and row["id"] not in focus:
            continue
        effective = row["effective"]
        if row["kind"] == "folder" or not effective["remaining"]:
            continue
        if not include_held and project in held:
            continue
        hits = []
        for field in enabled_dates:
            value = effective["schedule"].get(field)
            if value:
                instant = datetime.fromisoformat(value["instant"])
                hits.append((instant.astimezone(clock.zone).date(), "deferred" if field == "defer" else field))
        if tags.intersection(row["tags"]):
            hits.append((today, "tagged"))
        if flagged and effective["flagged"]:
            hits.append((today, "flagged"))
        visible = False
        for day, section in hits:
            if day in buckets:
                buckets[day][section].append(row["id"])
                visible = True
        if visible:
            matched.append(row)
    result = []
    for day, bucket in buckets.items():
        sections = [{"kind": kind, "ids": bucket[kind]} for kind in SECTIONS if bucket[kind]]
        ids = list(dict.fromkeys(item for group in sections for item in group["ids"]))
        if layout == "combined":
            sections = [{"kind": "combined", "ids": ids}] if ids else []
        result.append({"date": day.isoformat(), "sections": sections, "matchIds": ids, "count": len(ids)})
    return result, matched


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
    boundary = next_midnight(clock)
    if metadata["nextDateBoundary"]:
        boundary = min(boundary, datetime.fromisoformat(metadata["nextDateBoundary"]))
    return {"workspaceId": str(workspace.pk), "revision": workspace.revision, "today": today.isoformat(),
            "viewZone": clock.zone.key, "nextDateBoundary": boundary.isoformat(), "layout": layout,
            "days": day_rows, "rows": matches}
