"""Workspace-scoped outline access while its revision row is locked."""

from dataclasses import dataclass, field

from django.utils import timezone

from core.models import Item, Tag
from core.rules.properties import mode_for
from core.scheduling.storage import read_schedule

from .validation import CommandError, identifier, identifiers


LIBRARY_KINDS = {"project", "folder"}
TASK_KINDS = {"action", "group"}


@dataclass
class Changes:
    selection: list
    versions: dict = field(default_factory=dict)
    inverse: dict = field(default_factory=dict)

    def touch(self, obj):
        self.versions[str(obj.pk)] = obj.version


class Outline:
    def __init__(self, workspace):
        self.workspace = workspace
        self.items = Item.objects.filter(workspace=workspace, shelf="active")
        self.tags = Tag.objects.filter(workspace=workspace)

    def get(self, pk):
        try:
            return self.items.get(pk=pk)
        except Item.DoesNotExist as error:
            raise CommandError("Item unavailable.", 404) from error

    def selected(self, values):
        ids = identifiers(values)
        objects = self.items.in_bulk(ids)
        if len(objects) != len(ids):
            raise CommandError("Item unavailable.", 404)
        return [objects[pk] for pk in ids]

    def parent(self, value, *, library=False):
        if value == ("root" if library else "inbox"):
            return None
        if value in ("root", "inbox"):
            raise CommandError("These items cannot move into that list.")
        obj = self.get(identifier(value))
        allowed = {"folder"} if library else {"project", "group"}
        if obj.kind not in allowed:
            raise CommandError("Invalid parent for these items.")
        return obj

    def siblings(self, parent_id, *, library=False):
        kinds = LIBRARY_KINDS if library else TASK_KINDS
        return self.items.filter(parent_id=parent_id, kind__in=kinds).order_by("position", "id")


def save_changed(obj, changes, **values):
    changed = {key for key, val in values.items() if getattr(obj, key) != val}
    if not changed:
        return
    for key in changed:
        setattr(obj, key, values[key])
    if isinstance(obj, Item):
        obj.changed_at = timezone.now()
        changed.add("changed_at")
    obj.version += 1
    obj.save(update_fields=[*changed, "version"])
    changes.touch(obj)


def direct_item(item):
    return {
        "id": str(item.pk),
        "kind": item.kind,
        "parentId": str(item.parent_id) if item.parent_id else ("root" if item.kind in LIBRARY_KINDS else "inbox"),
        "title": item.title,
        "due": item.due.isoformat() if item.due else None,
        "done": item.done,
        "status": item.status, "mode": mode_for(item), "flagged": item.flagged,
        "autoComplete": item.auto_complete, "inProgress": item.in_progress, "schedule": read_schedule(item),
        "durationMinutes": item.duration_minutes,
        "tags": sorted(str(tag.pk) for tag in item.tags.all()),
        "version": item.version,
    }
