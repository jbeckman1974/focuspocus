"""Apply direct statuses and record automatically completed ancestors in the same receipt."""

from collections import Counter, deque
from datetime import datetime

from django.db.models import Count
from django.db.models.expressions import RawSQL
from django.utils import timezone

from core.repeats.resolution import advance, reject_historical_change
from core.rules.availability import RESOLVED
from core.rules.properties import status_updates

from .state import save_changed
from .validation import CommandError


def set_status(item, result, status, now):
    if item.status == status:
        return
    previous = {
        "status": item.status,
        "completedAt": item.completed_at.isoformat() if item.completed_at else None,
        "droppedAt": item.dropped_at.isoformat() if item.dropped_at else None,
    }
    result.inverse.setdefault("statuses", {})[str(item.pk)] = previous
    save_changed(item, result, **status_updates(status, now=now))


def validate_status(item, status):
    if status not in ("active", "held", "completed", "dropped"):
        raise CommandError("Unknown item status.")
    if (status == "held" and item.kind != "project") or (status == "completed" and item.kind == "folder"):
        raise CommandError("That status is unavailable for this item kind.")


def change_directly(item, desired, ancestors, selected):
    """Resolving a selection that contains a parent keeps its descendants' own state."""
    ancestor = ancestors.get(item.parent_id)
    while ancestor is not None:
        if desired in RESOLVED and (ancestor.pk in selected or ancestor.status in RESOLVED):
            return False
        if desired not in RESOLVED and ancestor.status in RESOLVED and ancestor.pk not in selected:
            raise CommandError("Reopen the resolved parent first.")
        ancestor = ancestors.get(ancestor.parent_id)
    return True


def selected_lineage(tree, items):
    """Load selected rows and their active ancestors in one query, also for deeply nested tasks."""
    lineage = {item.pk: item for item in items}
    parents = {item.parent_id for item in items if item.parent_id is not None}
    if parents:
        ancestor_ids = RawSQL("""
            WITH RECURSIVE ancestors(id, parent_id) AS (
                SELECT id, parent_id FROM core_item
                WHERE workspace_id = %s AND shelf = 'active' AND id = ANY(%s::uuid[])
                UNION
                SELECT parent.id, parent.parent_id FROM core_item parent
                JOIN ancestors child ON child.parent_id = parent.id
                WHERE parent.workspace_id = %s AND parent.shelf = 'active'
            )
            SELECT id FROM ancestors
        """, (tree.workspace.pk, list(parents), tree.workspace.pk))
        for ancestor in tree.items.filter(pk__in=ancestor_ids):
            lineage.setdefault(ancestor.pk, ancestor)
    return lineage


def unresolved_children(tree, lineage):
    parents = [key for key, item in lineage.items() if item.auto_complete and item.status == "active"]
    children = tree.items.filter(parent_id__in=parents, done=False).exclude(disposition="dropped")
    return Counter(dict(children.values_list("parent_id").annotate(total=Count("pk"))))


def apply_status(tree, result, items, desired, *, skip=False):
    for item in items:
        validate_status(item, desired)
    by_id = selected_lineage(tree, items)
    selected = {item.pk for item in items}
    writable = [item for item in items if change_directly(item, desired, by_id, selected)]
    unresolved = unresolved_children(tree, by_id) if desired in RESOLVED else Counter()
    parents = deque()
    now = timezone.now()
    for item in writable:
        prior = item.status
        reject_historical_change(tree, item, desired)
        set_status(item, result, desired, now)
        by_id[item.pk] = item
        if prior not in RESOLVED and desired in RESOLVED:
            outcome = "skipped" if skip else desired
            if not advance(tree, result, item, outcome, now):
                unresolved[item.parent_id] -= 1
                parents.append(item.parent_id)
    while parents:
        parent = by_id.get(parents.popleft())
        if parent is None or not parent.auto_complete or parent.status != "active" or unresolved[parent.pk]:
            continue
        set_status(parent, result, "completed", now)
        if not advance(tree, result, parent, "completed", now):
            unresolved[parent.parent_id] -= 1
            parents.append(parent.parent_id)


def restore_statuses(tree, result, inverse):
    if "statuses" in inverse:
        prior = inverse["statuses"]
    else:
        # M2 completion receipts predate recorded resolution timestamps.
        prior = {key: {"status": "completed" if done else "active", "completedAt": None, "droppedAt": None}
                 for key, done in inverse["done"].items()}
    items = tree.items.in_bulk(prior)
    if len(items) != len(prior):
        raise CommandError("The items changed after this status update.", 409)
    for item in items.values():
        old = prior[str(item.pk)]
        values = status_updates(old["status"])
        values["completed_at"] = datetime.fromisoformat(old["completedAt"]) if old["completedAt"] else None
        values["dropped_at"] = datetime.fromisoformat(old["droppedAt"]) if old["droppedAt"] else None
        save_changed(item, result, **values)
