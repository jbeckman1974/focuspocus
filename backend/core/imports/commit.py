"""Append the reviewed source hierarchy in one transaction without changing existing items."""

from datetime import datetime
from uuid import uuid4

from core.commands.edits import GAP
from core.commands.state import LIBRARY_KINDS
from core.content.models import ItemNote
from core.content.notes import validate_document
from core.models import Change, Item, ItemTag, Tag
from core.planning.schedules import initialize_projects
from core.repeats.models import Occurrence, RepeatSeries
from core.scheduling.storage import legacy_due_value

from .models import ImportMapping
from .ordering import last_positions, sibling_orders
from .staging import bindings


def advance(workspace, affected, *, removed=False):
    if affected:
        workspace.revision += 1
        workspace.save(update_fields=["revision"])
        ids = sorted(str(i) for i in affected)
        Change.objects.create(workspace=workspace, revision=workspace.revision, affected=ids,
                              removed=ids if removed else [])


def make_item(workspace, row, parent, position):
    values = row["fields"]
    status = values.get("status", "active")
    schedule = values.get("schedule", {})
    return Item(id=uuid4(), workspace=workspace, kind=row["kind"], title=row["title"], parent_id=parent,
                position=position, flagged=values.get("flagged", False), done=status == "completed",
                disposition=status if status in ("dropped", "held") else "active", mode=values.get("mode"),
                auto_complete=values.get("autoComplete", False), duration_minutes=values.get("durationMinutes"),
                completed_at=datetime.fromisoformat(values["completedAt"]) if status == "completed" and values.get("completedAt") else None,
                dropped_at=datetime.fromisoformat(values["droppedAt"]) if status == "dropped" and values.get("droppedAt") else None,
                schedule=schedule, due=legacy_due_value(schedule))


def commit(workspace, batch):
    known, matches = bindings(workspace, batch)
    new_items, tags, notes, links, maps, series, occurrences = [], {}, [], [], [], [], []
    parents, last, groups = {}, last_positions(workspace), set()
    for row in batch.rows:
        if row["key"] in known:
            parents[row["line"]] = known[row["key"]]
            continue
        parent = parents.get(row["parentLine"])
        key = (parent, row["kind"] in LIBRARY_KINDS)
        last[key] = last.get(key, 0) + GAP
        groups.add(key)
        item = make_item(workspace, row, parent, last[key])
        new_items.append(item)
        parents[row["line"]] = item.pk
        maps.append(ImportMapping(workspace=workspace, batch=batch, source_key=row["key"],
                                  source_id=row["sourceId"], line=row["line"], item_id=item.pk))
        values = row["fields"]
        for name in values.get("tags", []):
            if matches.get(name):
                tag = matches[name][0]
            else:
                if name not in tags:
                    tags[name] = Tag(workspace=workspace, title=name)
                tag = tags[name]
            links.append(ItemTag(workspace=workspace, item=item, tag=tag))
        if values.get("note"):
            document, plain = validate_document({"paragraphs": [[{"text": s}] for s in values["note"].split("\n")]})
            notes.append(ItemNote(workspace=workspace, item=item, document=document, plain_text=plain))
        if "repeat" in values:
            rule = values["repeat"]
            s = RepeatSeries(workspace=workspace, rule=rule, origin=item.schedule, remaining=rule.get("count"))
            series.append(s)
            occurrences.append(Occurrence(workspace=workspace, item=item, series=s))
    Item.objects.bulk_create(new_items)
    Tag.objects.bulk_create(tags.values())
    ItemTag.objects.bulk_create(links)
    ItemNote.objects.bulk_create(notes)
    RepeatSeries.objects.bulk_create(series)
    Occurrence.objects.bulk_create(occurrences)
    initialize_projects(workspace, new_items)
    ImportMapping.objects.bulk_create(maps)
    batch.guard = {"items": {str(i.pk): i.version for i in new_items}, "tags": {str(t.pk): t.version for t in tags.values()},
                   "groups": sibling_orders(workspace, groups)}
    batch.status = "committed"
    batch.save(update_fields=["guard", "status"])
    advance(workspace, [i.pk for i in new_items] + [t.pk for t in tags.values()])
