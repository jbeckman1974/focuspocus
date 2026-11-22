"""Project a private, ordered set of evaluated rows onto display-zone calendar days."""

from collections import defaultdict
from datetime import datetime, timedelta

from core.queries.outline import tree_order
from .calendar import local_today


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
