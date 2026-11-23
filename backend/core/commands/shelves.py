"""Retain removed subtrees in place and copy archived records back into active work."""

from collections import defaultdict
from datetime import datetime, time
from zoneinfo import ZoneInfo
from uuid import uuid4

from django.utils import timezone as clock

from core.history.recording import create_many
from core.models import Item, ItemTag
from core.planning.schedules import initialize_projects

from .edits import GAP
from .state import Changes, LIBRARY_KINDS, save_changed
from .structure import Layout
from .validation import CommandError, due_date, fields, identifiers


def cutoff(value, workspace):
    day = due_date(value)
    if day is None:
        raise CommandError("Choose an archive cutoff date.")
    return datetime.combine(day, time.min, tzinfo=ZoneInfo(workspace.time_zone))


def archive_eligible(item, boundary):
    return ((item.done and item.completed_at is not None and item.completed_at < boundary)
            or (item.disposition == "dropped" and item.changed_at is not None and item.changed_at < boundary))


def subtree(children, root):
    stack = [root]
    while stack:
        item = stack.pop()
        yield item
        stack.extend(reversed(children[item.pk]))


def remove(tree, name, data):
    archived = name == "archive"
    fields(data, ["ids", "before"] if archived else ["ids"])
    layout = Layout(tree, tree.selected(data["ids"]))
    boundary = cutoff(data["before"], tree.workspace) if archived else None
    result = Changes([])
    for root in layout.roots:
        if archived and not archive_eligible(root, boundary):
            raise CommandError("A selection no longer meets this archive cutoff.", 409)
        peers = list(tree.siblings(root.parent_id, library=root.kind in LIBRARY_KINDS))
        index = next(i for i, item in enumerate(peers) if item.pk == root.pk)
        following = peers[index + 1].pk if index + 1 < len(peers) else None
        for item in subtree(layout.children, root):
            # Archiving changes storage placement. Retain the content timestamp
            # the operator used when choosing which completed or dropped work to archive.
            item.shelf = "archive" if archived else "trash"
            item.shelf_root = root.pk
            item.shelf_before = following if item.pk == root.pk else None
            item.is_miscellaneous = False
            item.version += 1
            item.save(update_fields=["shelf", "shelf_root", "shelf_before", "is_miscellaneous", "version"])
            result.touch(item)
    return result


def removed_roots(tree, shelf, values):
    requested = identifiers(values)
    rows = Item.objects.filter(workspace=tree.workspace, shelf=shelf, shelf_root__in=requested)
    found = {row.pk: row for row in rows if row.pk == row.shelf_root}
    if set(requested) != found.keys():
        raise CommandError("Removed item unavailable.", 404)
    return sorted(found.values(), key=lambda item: (item.position, item.pk))


def destination(tree, root, payload):
    if "parentId" in payload:
        parent = tree.parent(payload["parentId"], library=root.kind in LIBRARY_KINDS)
        return parent.pk if parent else None
    if root.parent_id is None:
        return None
    available = tree.items.filter(pk=root.parent_id).first()
    if available is None:
        raise CommandError("Original destination unavailable. Choose a destination.", 409)
    # A previous parent can still exist with a different kind after structural changes.
    try:
        tree.parent(str(available.pk), library=root.kind in LIBRARY_KINDS)
    except CommandError as error:
        raise CommandError("Original destination no longer accepts these items. Choose a destination.", 409) from error
    return available.pk


def insert_root(tree, obj, original, parent_id, result, *, duplicate=False):
    peers = list(tree.siblings(parent_id, library=obj.kind in LIBRARY_KINDS).exclude(pk=obj.pk))
    index = len(peers)
    if duplicate:
        index = next(i + 1 for i, item in enumerate(peers) if item.pk == original.pk)
    elif parent_id == original.parent_id:
        if original.shelf_before in {item.pk for item in peers}:
            index = next(i for i, item in enumerate(peers) if item.pk == original.shelf_before)
        else:
            index = next((i for i, item in enumerate(peers) if item.position > original.position), len(peers))
    for rank, item in enumerate(peers[:index] + [obj] + peers[index:], 1):
        save_changed(item, result, parent_id=parent_id, position=rank * GAP)


def copy_subtree(tree, source, parent_id, result, *, duplicate=False, repeat_successor=False):
    originals = list(source)
    root = originals[0]
    copies = {}
    now = clock.now()
    for item in originals:
        copy = Item(
            workspace=tree.workspace, id=uuid4(), title=item.title, kind=item.kind, position=item.position,
            parent_id=parent_id if item.pk == root.pk else copies[item.parent_id].pk,
            schedule=item.schedule, duration_minutes=item.duration_minutes, due=item.due, done=item.done, mode=item.mode, flagged=item.flagged, auto_complete=item.auto_complete,
            disposition=item.disposition, completed_at=item.completed_at, dropped_at=item.dropped_at,
            in_progress=False if repeat_successor else item.in_progress,
            changed_at=now, created_at=now,
            filing_project_id=(item.filing_project_id if item.pk == root.pk and parent_id is None
                               and item.filing_project_id and tree.items.filter(pk=item.filing_project_id, kind="project").exists() else None),
        )
        copies[item.pk] = copy
    create_many(Item, copies.values())
    initialize_projects(tree.workspace, copies.values())
    tags = ItemTag.objects.filter(workspace=tree.workspace, item_id__in=copies).values_list("item_id", "tag_id")
    create_many(ItemTag, [ItemTag(workspace=tree.workspace, item=copies[item_id], tag_id=tag_id)
                                 for item_id, tag_id in tags])
    from core.content.copying import copy_content
    copy_content(tree.workspace, copies)
    for item in copies.values():
        result.touch(item)
    insert_root(tree, copies[root.pk], root, parent_id, result, duplicate=duplicate)
    result.selection.append(str(copies[root.pk].pk))
    if not repeat_successor:
        from core.repeats.templates import copy_series
        copy_series(tree, copies)
    return copies


def duplicate(tree, data):
    fields(data, ["ids"])
    layout = Layout(tree, tree.selected(data["ids"]))
    result = Changes([])
    for root in layout.roots:
        copy_subtree(tree, subtree(layout.children, root), root.parent_id, result, duplicate=True)
    return result


def recover(tree, name, data):
    fields(data, ["ids"], ["parentId"])
    shelf = "trash" if name == "restore" else "archive"
    roots = removed_roots(tree, shelf, data["ids"])
    result = Changes([])
    for original in roots:
        parent_id = destination(tree, original, data)
        members = list(Item.objects.filter(workspace=tree.workspace, shelf=shelf,
                                          shelf_root=original.pk).order_by("position", "id"))
        if name == "retrieve":
            children = defaultdict(list)
            for item in members:
                children[item.parent_id].append(item)
            copy_subtree(tree, subtree(children, original), parent_id, result)
            continue
        for item in members:
            save_changed(item, result, shelf="active", shelf_root=None, shelf_before=None)
        root = next(item for item in members if item.pk == original.pk)
        insert_root(tree, root, original, parent_id, result)
        result.selection.append(str(root.pk))
    return result


def ungroup(tree, data):
    fields(data, ["ids"])
    layout = Layout(tree, tree.selected(data["ids"]))
    if any(root.kind != "group" for root in layout.roots) or len(layout.roots) != len(data["ids"]):
        raise CommandError("Choose nonoverlapping action groups to ungroup.")
    result = Changes([])
    for root in layout.roots:
        siblings = list(tree.siblings(root.parent_id))
        index = next(i for i, sibling in enumerate(siblings) if sibling.pk == root.pk)
        children = list(tree.siblings(root.pk))
        ordered = siblings[:index] + children + siblings[index + 1:]
        for rank, item in enumerate(ordered, 1):
            save_changed(item, result, parent_id=root.parent_id, position=rank * GAP)
        after = ordered[index + len(children)] if index + len(children) < len(ordered) else None
        save_changed(root, result, shelf="trash", shelf_root=root.pk, shelf_before=after.pk if after else None)
        result.selection.extend(str(item.pk) for item in children)
    return result
