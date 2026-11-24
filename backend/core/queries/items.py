"""Read active item fields and scoped tag edges without materializing Django model graphs."""

from collections import defaultdict

from core.models import Item, ItemTag, Tag
from core.rules.properties import mode_for
from core.scheduling.storage import read_schedule


ITEM_FIELDS = (
    "id", "parent_id", "kind", "position", "title", "version", "done", "disposition", "mode",
    "flagged", "auto_complete", "in_progress", "filing_project_id", "due", "schedule", "duration_minutes",
    "created_at", "changed_at", "completed_at", "dropped_at",
)


def iso(value):
    return value.isoformat() if value is not None else None


def read_tags(workspace):
    tags = Tag.objects.filter(workspace=workspace).order_by("title", "id")
    rows, keys = [], {}
    for tag in tags:
        key = keys[tag.pk] = str(tag.pk)
        rows.append({"id": key, "title": tag.title, "version": tag.version,
                     "parentId": str(tag.parent_id) if tag.parent_id else None,
                     "status": tag.status, "exclusive": tag.exclusive})
    by_item = defaultdict(list)
    if keys:
        edges = ItemTag.objects.filter(workspace=workspace, item__workspace=workspace, item__shelf="active",
                                       tag__workspace=workspace).order_by("tag__title", "tag_id")
        for item_id, tag_id in edges.values_list("item_id", "tag_id"):
            by_item[item_id].append(keys[tag_id])
    return rows, by_item


def active_items(workspace):
    return Item.objects.filter(workspace=workspace, shelf="active").order_by("position", "id")


def parent_key(parent_id, kind):
    return str(parent_id) if parent_id else ("root" if kind in ("folder", "project") else "inbox")


def search_rows(workspace, tags_by_item):
    items = active_items(workspace).values_list("id", "parent_id", "kind", "title")
    return [{"id": str(key), "parentId": parent_key(parent, kind), "kind": kind, "title": title,
             "tags": tags_by_item.get(key, [])} for key, parent, kind, title in items.iterator()]


def direct_rows(workspace, tags_by_item):
    rows = []
    for item in active_items(workspace).values_list(*ITEM_FIELDS, named=True).iterator():
        rows.append({
            "id": str(item.id), "kind": item.kind, "parentId": parent_key(item.parent_id, item.kind), "title": item.title,
            "version": item.version, "position": item.position, "tags": tags_by_item.get(item.id, []),
            "due": iso(item.due), "schedule": read_schedule(item), "durationMinutes": item.duration_minutes,
            "done": item.done, "status": "completed" if item.done else item.disposition, "mode": mode_for(item),
            "flagged": item.flagged, "autoComplete": item.auto_complete, "inProgress": item.in_progress,
            "filingProjectId": str(item.filing_project_id) if item.filing_project_id else None,
            "createdAt": iso(item.created_at), "changedAt": iso(item.changed_at),
            "completedAt": iso(item.completed_at), "droppedAt": iso(item.dropped_at),
        })
    return rows
