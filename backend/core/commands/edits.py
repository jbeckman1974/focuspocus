from django.db.models import Max

from core.models import Item, ItemTag, Receipt, Tag

from .state import Changes, save_changed
from .validation import CommandError, due_date, fields, identifier, title


GAP = 1024


def next_position(query):
    return (query.aggregate(last=Max("position"))["last"] or 0) + GAP


def create_entry(tree, name, data):
    fields(data, ["id", "title"])
    values = {"workspace": tree.workspace, "id": identifier(data["id"]), "title": title(data["title"])}
    if name == "create-tag":
        entry = Tag.objects.create(**values)
    else:
        entry = Item.objects.create(
            **values, kind="project", position=next_position(tree.items.filter(kind="project"))
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
    pending = []
    for row in rows:
        fields(row, ["id", "title"])
        pending.append(Item(
            workspace=tree.workspace, parent=parent, id=identifier(row["id"]),
            title=title(row["title"]), kind="action", position=position,
        ))
        position += GAP
    result = Changes([str(item.pk) for item in pending])
    if len(set(result.selection)) != len(pending):
        raise CommandError("Duplicate item identifiers.")
    Item.objects.bulk_create(pending)
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
    fields(data, ["ids", "tagId", "enabled"])
    if type(data["enabled"]) is not bool:
        raise CommandError("Choose whether to apply or remove the tag.")
    tag = tree.tags.filter(pk=identifier(data["tagId"])).first()
    if tag is None:
        raise CommandError("Tag unavailable.", 404)
    items = tree.selected(data["ids"])
    result = Changes([str(item.pk) for item in items])
    for item in items:
        links = ItemTag.objects.filter(workspace=tree.workspace, item=item, tag=tag)
        if data["enabled"]:
            _, changed = links.get_or_create(workspace=tree.workspace, item=item, tag=tag)
        else:
            changed, _ = links.delete()
        if changed:
            item.version += 1
            item.save(update_fields=["version"])
            result.touch(item)
    return result


def complete(tree, name, data):
    fields(data, ["ids"])
    items = tree.selected(data["ids"])
    ids = {item.pk for item in items}
    result = Changes([str(item.pk) for item in items])
    saved = {}
    target = name == "complete"
    by_id = tree.items.only("id", "parent_id", "done").in_bulk()
    for item in items:
        parent = by_id.get(item.parent_id)
        while parent is not None:
            if target and (parent.done or parent.pk in ids):
                break
            if not target and parent.done and parent.pk not in ids:
                raise CommandError("Reopen the completed parent first.")
            parent = by_id.get(parent.parent_id)
        else:
            if item.done != target:
                saved[str(item.pk)] = item.done
                save_changed(item, result, done=target)
    if saved:
        result.inverse = {"done": saved}
    return result


def undo(tree, user, data):
    fields(data, ["operationId", "contextId"])
    receipt = Receipt.objects.filter(
        workspace=tree.workspace, actor=user, context_id=identifier(data["contextId"]),
        operation_id=identifier(data["operationId"]),
    ).first()
    if receipt is None or not receipt.inverse.get("done"):
        raise CommandError("Reversible completion unavailable.", 404)
    if tree.workspace.revision != receipt.result["revision"]:
        raise CommandError("The workspace changed after this completion.", 409)
    prior = receipt.inverse["done"]
    items = tree.selected(list(prior))
    result = Changes(receipt.result["selection"])
    for item in items:
        save_changed(item, result, done=prior[str(item.pk)])
    return result
