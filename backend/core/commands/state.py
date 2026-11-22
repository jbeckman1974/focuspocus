"""Workspace-scoped outline access while its revision row is locked."""

from dataclasses import dataclass, field

from core.models import Item, Tag

from .validation import CommandError, identifier, identifiers


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
        self.items = Item.objects.filter(workspace=workspace)
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

    def parent(self, value):
        if value == "inbox":
            return None
        obj = self.get(identifier(value))
        if obj.kind not in ("project", "group"):
            raise CommandError("Choose an Inbox, a project or an action group.")
        return obj

    def siblings(self, parent_id):
        return self.items.filter(parent_id=parent_id).exclude(kind="project").order_by("position", "id")


def save_changed(obj, changes, **values):
    changed = {key for key, val in values.items() if getattr(obj, key) != val}
    if not changed:
        return
    for key in changed:
        setattr(obj, key, values[key])
    obj.version += 1
    obj.save(update_fields=[*changed, "version"])
    changes.touch(obj)


def direct_item(item):
    return {
        "id": str(item.pk),
        "kind": item.kind,
        "parentId": str(item.parent_id) if item.parent_id else ("root" if item.kind == "project" else "inbox"),
        "title": item.title,
        "due": item.due.isoformat() if item.due else None,
        "done": item.done,
        "tags": [str(pk) for pk in item.tags.order_by("id").values_list("pk", flat=True)],
        "version": item.version,
    }
