"""Validate all rollback dependencies together before deleting a batch's own records."""

from uuid import UUID

from core.content.models import AttachmentLink
from core.models import Item, ItemTag, Tag
from core.perspectives.models import PerspectiveState, SavedPerspective
from core.repeats.models import Occurrence, RepeatSeries

from .commit import advance
from .models import ImportMapping
from .ordering import sibling_orders


def references_any(value, ids):
    pending = [value]
    while pending:
        node = pending.pop()
        if isinstance(node, str) and node in ids:
            return True
        if isinstance(node, dict):
            pending.extend(node.values())
        elif isinstance(node, list):
            pending.extend(node)
    return False


def extension_refs(model, ids, exceptions):
    """A later module may attach personal reminders or places without modifying an item version."""
    for relation in model._meta.related_objects:
        if relation.related_model._meta.label_lower not in exceptions:
            field = relation.field
            if relation.many_to_many:
                continue
            query = {field.attname + "__in": ids}
            if relation.related_model._default_manager.filter(**query).exists():
                return True
    return False


def conflicts(workspace, batch):
    guard = batch.guard
    items, tags = set(guard["items"]), set(guard["tags"])
    problems = []
    for model, ids, field, versions in ((Item, items, "itemId", guard["items"]), (Tag, tags, "tagId", guard["tags"])):
        found = {str(pk): version for pk, version in model.objects.filter(workspace=workspace, pk__in=ids).values_list("pk", "version")}
        problems.extend({field: key, "reason": "Record changed or is unavailable."} for key in ids if found.get(key) != versions[key])
    groups = {(UUID(g["parent"]) if g["parent"] else None, g["library"]) for g in guard["groups"]}
    if sibling_orders(workspace, groups) != guard["groups"]:
        problems.append({"reason": "Sibling membership or order changed."})
    outside = Item.objects.filter(workspace=workspace).exclude(pk__in=items)
    for field in ("parent_id", "filing_project_id", "shelf_root", "shelf_before"):
        if outside.filter(**{field + "__in": items}).exists():
            problems.append({"reason": "An outside item now refers to the imported hierarchy."})
            break
    if (ItemTag.objects.filter(workspace=workspace, tag_id__in=tags).exclude(item_id__in=items).exists()
            or Tag.objects.filter(workspace=workspace, parent_id__in=tags).exclude(pk__in=tags).exists()):
        problems.append({"reason": "An imported tag has new links or children."})
    if AttachmentLink.objects.filter(workspace=workspace, item_id__in=items).exists():
        problems.append({"reason": "An imported item now holds a file."})
    occurrences = Occurrence.objects.filter(workspace=workspace, item_id__in=items)
    if Occurrence.objects.filter(series_id__in=occurrences.values("series_id")).exclude(item_id__in=items).exists():
        problems.append({"reason": "A repeat series now has another occurrence."})
    if extension_refs(Item, items, {"core.item", "core.itemtag", "core.itemnote", "core.attachmentlink",
                                    "core.projectreview", "core.occurrence"}) or extension_refs(
            Tag, tags, {"core.tag", "core.itemtag", "core.item"}):
        problems.append({"reason": "Another record now depends on an imported item or tag."})
    targets = items | tags
    if targets and (any(references_any(v, targets) for v in PerspectiveState.objects.filter(workspace=workspace).values_list("focus_ids", flat=True))
                    or any(references_any(v, targets) for v in SavedPerspective.objects.filter(state__workspace=workspace).values_list("definition", flat=True))):
        problems.append({"reason": "Later workspace activity depends on an imported record."})
    return problems


def rollback(workspace, batch):
    problems = conflicts(workspace, batch)
    if problems:
        batch.conflicts = problems
        batch.save(update_fields=["conflicts"])
        return problems
    ids, tags = list(batch.guard["items"]), list(batch.guard["tags"])
    series = list(Occurrence.objects.filter(workspace=workspace, item_id__in=ids).values_list("series_id", flat=True))
    Item.objects.filter(workspace=workspace, pk__in=ids).delete()
    Tag.objects.filter(workspace=workspace, pk__in=tags).delete()
    RepeatSeries.objects.filter(workspace=workspace, pk__in=series).delete()
    ImportMapping.objects.filter(workspace=workspace, batch=batch).update(active=False)
    batch.conflicts, batch.status = [], "rolled_back"
    batch.save(update_fields=["status", "conflicts"])
    advance(workspace, ids + tags)
    return []
