"""Resolve the actor's explicit project/folder focus against this workspace's live tree."""

from collections import defaultdict


def descendants(rows, roots):
    children = defaultdict(list)
    for row in rows:
        children[row["parentId"]].append(row["id"])
    visible = {row["id"] for row in rows}
    stack = [target for target in roots if target in visible]
    result = set()
    while stack:
        target = stack.pop()
        if target not in result:
            result.add(target)
            stack.extend(children[target])
    return result


def focused_ids(workspace, user, rows):
    from .models import PerspectiveState

    roots = PerspectiveState.objects.filter(workspace=workspace, user=user).values_list("focus_ids", flat=True).first()
    return descendants(rows, roots) if roots else None


def perspective_version(workspace, user):
    from .models import PerspectiveState

    version = PerspectiveState.objects.filter(workspace=workspace, user=user).values_list("version", flat=True).first()
    return version or 0
