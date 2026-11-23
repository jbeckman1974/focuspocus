"""Serialize one scoped set of items for the snapshot and filtered projections."""

from django.db.models import Prefetch

from core.scheduling.clock import workspace_clock
from core.models import Item, Tag
from core.repeats.read import repeat_states
from core.rules.projection import evaluate_items
from core.rules.properties import mode_for
from .calendar import schedules_for


def iso(value):
    return value.isoformat() if value is not None else None


def record(item, effective, direct_dates, effective_dates):
    parent = str(item.parent_id) if item.parent_id else ("root" if item.kind in ("folder", "project") else "inbox")
    return {
        "id": str(item.pk), "kind": item.kind, "parentId": parent, "title": item.title,
        "version": item.version, "position": item.position, "tags": [str(tag.pk) for tag in item.snapshot_tags],
        "due": iso(item.due), "schedule": direct_dates, "durationMinutes": item.duration_minutes,
        "done": item.done, "status": item.status, "mode": mode_for(item),
        "flagged": item.flagged, "autoComplete": item.auto_complete, "inProgress": item.in_progress,
        "filingProjectId": str(item.filing_project_id) if item.filing_project_id else None,
        "createdAt": iso(item.created_at), "changedAt": iso(item.changed_at),
        "completedAt": iso(item.completed_at), "droppedAt": iso(item.dropped_at),
        "effective": {
            "schedule": effective_dates,
            "status": effective.status, "statusSource": effective.status_source,
            "flagged": effective.flagged, "flagSource": effective.flag_source,
            "remaining": effective.remaining, "available": effective.available,
            "firstAvailable": effective.first_available, "blocked": effective.blocked,
            "reason": effective.reason, "reasonSource": effective.reason_source,
        },
    }


def read_records(workspace, view_zone=None, *, clock=None):
    tags = Tag.objects.filter(workspace=workspace).order_by("title", "id")
    items = list(Item.objects.filter(workspace=workspace, shelf="active").order_by("position", "id").prefetch_related(
        Prefetch("tags", queryset=tags, to_attr="snapshot_tags")
    ))
    clock = clock or workspace_clock(workspace, view_zone=view_zone)
    direct, dates, defer, boundary = schedules_for(items, clock)
    effective = evaluate_items(items, now=clock.now, direct_defer=defer)
    repeats = repeat_states(workspace, [item.pk for item in items])
    rows = []
    for item in items:
        key = str(item.pk)
        rows.append({**record(item, effective[key], direct[key], dates[key]), "repeat": repeats.get(item.pk)})
    tag_rows = [{"id": str(tag.pk), "title": tag.title, "version": tag.version,
                 "parentId": str(tag.parent_id) if tag.parent_id else None,
                 "status": tag.status, "exclusive": tag.exclusive} for tag in tags]
    metadata = {
        "timeZone": workspace.time_zone, "viewZone": clock.zone.key,
        "dateDefaults": {field: value.strftime("%H:%M") for field, value in clock.defaults.items()},
        "nextDateBoundary": iso(boundary),
    }
    return rows, tag_rows, metadata
