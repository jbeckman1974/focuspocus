"""Apply direct statuses and record automatically completed ancestors in the same receipt."""

from collections import Counter, deque
from datetime import datetime

from django.utils import timezone

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


def apply_status(tree, result, items, desired):
    for item in items:
        validate_status(item, desired)
    by_id = tree.items.in_bulk()
    selected = {item.pk for item in items}
    writable = [item for item in items if change_directly(item, desired, by_id, selected)]
    unresolved = Counter(item.parent_id for item in by_id.values() if item.status not in RESOLVED)
    parents = deque()
    now = timezone.now()
    for item in writable:
        prior = item.status
        set_status(item, result, desired, now)
        by_id[item.pk] = item
        if prior not in RESOLVED and desired in RESOLVED:
            unresolved[item.parent_id] -= 1
            parents.append(item.parent_id)
    while parents:
        parent = by_id.get(parents.popleft())
        if parent is None or not parent.auto_complete or parent.status != "active" or unresolved[parent.pk]:
            continue
        set_status(parent, result, "completed", now)
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
