"""Project prefetched, workspace-scoped database rows into the task policy evaluator."""

from .availability import Node, evaluate
from .properties import mode_for


def evaluate_items(items, *, now, direct_defer=None):
    direct_defer = {} if direct_defer is None else direct_defer
    nodes = []
    for item in items:
        tags = getattr(item, "snapshot_tags", None)
        if tags is None:
            tags = item.tags.all()
        held_tags = [str(tag.pk) for tag in tags if tag.status == "held"]
        nodes.append(Node(
            id=str(item.pk), parent_id=str(item.parent_id) if item.parent_id else None,
            position=item.position, kind=item.kind, mode=mode_for(item), status=item.status,
            flagged=item.flagged, held_tag=min(held_tags, default=None), defer_until=direct_defer.get(str(item.pk)),
        ))
    return evaluate(nodes, now=now)
