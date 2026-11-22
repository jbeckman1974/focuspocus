"""Project workspace records into the task policy evaluator."""

from .availability import Node, evaluate


def evaluate_rows(rows, held_tags, *, now, direct_defer):
    nodes = (
        Node(id=row["id"], parent_id=None if row["parentId"] in ("inbox", "root") else row["parentId"],
             position=row["position"], kind=row["kind"], mode=row["mode"], status=row["status"],
             flagged=row["flagged"], held_tag=min((tag for tag in row["tags"] if tag in held_tags), default=None),
             defer_until=direct_defer.get(row["id"]))
        for row in rows
    )
    return evaluate(nodes, now=now)
