"""Snapshot sibling lists for deterministic appends and rollback preconditions."""

from django.db.models import Max

from core.commands.state import LIBRARY_KINDS
from core.models import Item


def last_positions(workspace):
    groups = Item.objects.filter(workspace=workspace, shelf="active").values("parent_id", "kind").annotate(last=Max("position"))
    positions = {}
    for group in groups:
        key = (group["parent_id"], group["kind"] in LIBRARY_KINDS)
        positions[key] = max(positions.get(key, 0), group["last"])
    return positions


def sibling_orders(workspace, groups):
    orders = {key: [] for key in groups}
    peers = Item.objects.filter(workspace=workspace, shelf="active").order_by("position", "id")
    for pk, parent, kind in peers.values_list("pk", "parent_id", "kind").iterator():
        key = (parent, kind in LIBRARY_KINDS)
        if key in orders:
            orders[key].append(str(pk))
    return [{"parent": str(parent) if parent else None, "library": library, "ids": ids}
            for (parent, library), ids in sorted(orders.items(), key=lambda pair: str(pair[0]))]
