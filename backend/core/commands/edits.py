from django.db.models import Max

from core.models import Item, ItemTag, Receipt

from .completion import apply_status, restore_statuses
from .state import Changes, save_changed
from . import tagging
from .validation import CommandError, due_date, fields, identifier, title


GAP = 1024


def next_position(query):
    return (query.aggregate(last=Max("position"))["last"] or 0) + GAP


def create_entry(tree, name, data):
    if name == "create-tag":
        return tagging.create_tag(tree, data)
    fields(data, ["id", "title"], ["kind", "parentId"])
    kind = data.get("kind", "project")
    if kind not in ("folder", "project"):
        raise CommandError("Choose a folder or project.")
    parent = tree.parent(data.get("parentId", "root"), library=True)
    parent_id = parent.pk if parent else None
    entry = Item.objects.create(
        workspace=tree.workspace, id=identifier(data["id"]), title=title(data["title"]),
        kind=kind, parent_id=parent_id, position=next_position(tree.siblings(parent_id, library=True)),
    )
    result = Changes([str(entry.pk)])
    result.touch(entry)
    return result


def capture(tree, data):
    fields(data, ["items", "parentId"])
    parent = tree.parent(data["parentId"])
    rows = data["items"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
        raise CommandError("Capture between 1 and 200 actions.")
    position = next_position(tree.siblings(parent.pk if parent else None))
    pending, links = [], []
    tag_tree = tagging.TagTree(tree)
    inherited = [tag_tree.tags[pk] for pk in parent.tags.values_list("pk", flat=True)] if parent else []
    for row in rows:
        fields(row, ["id", "title"], ["tagIds", "filingProjectId"])
        filing = row.get("filingProjectId")
        if filing is not None:
            project = tree.get(identifier(filing))
            if parent or project.kind != "project":
                raise CommandError("An Inbox filing destination must be a project.")
            filing = project.pk
        pending.append(Item(
            workspace=tree.workspace, parent=parent, id=identifier(row["id"]),
            title=title(row["title"]), kind="action", position=position, filing_project_id=filing,
        ))
        links.extend(ItemTag(workspace=tree.workspace, item=pending[-1], tag=tag)
                     for tag in tagging.insertion_tags(tag_tree, row, inherited))
        position += GAP
    result = Changes([str(item.pk) for item in pending])
    if len(set(result.selection)) != len(pending):
        raise CommandError("Duplicate item identifiers.")
    Item.objects.bulk_create(pending)
    ItemTag.objects.bulk_create(links)
    for item in pending:
        result.touch(item)
    return result


def edit(tree, data):
    fields(data, ["ids"], ["title", "due"])
    changes = {}
    if "title" in data:
        changes["title"] = title(data["title"])
    if "due" in data:
        changes["due"] = due_date(data["due"])
    if not changes:
        raise CommandError("Choose a field to edit.")
    items = tree.selected(data["ids"])
    result = Changes([str(item.pk) for item in items])
    for item in items:
        save_changed(item, result, **changes)
    return result


def set_tags(tree, data):
    return tagging.set_tags(tree, data)


def complete(tree, name, data):
    fields(data, ["ids"])
    items = tree.selected(data["ids"])
    result = Changes([str(item.pk) for item in items])
    apply_status(tree, result, items, "completed" if name == "complete" else "active")
    return result


def undo(tree, user, data):
    fields(data, ["operationId", "contextId"])
    receipt = Receipt.objects.filter(
        workspace=tree.workspace, actor=user, context_id=identifier(data["contextId"]),
        operation_id=identifier(data["operationId"]),
    ).first()
    if receipt is None or not (receipt.inverse.get("done") or receipt.inverse.get("statuses")):
        raise CommandError("Reversible completion unavailable.", 404)
    if tree.workspace.revision != receipt.result["revision"]:
        raise CommandError("The workspace changed after this completion.", 409)
    result = Changes(receipt.result["selection"])
    restore_statuses(tree, result, receipt.inverse)
    return result
