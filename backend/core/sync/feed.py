"""Workspace reads taken under the same revision lock as command commits."""

from datetime import timedelta

from django.core import signing
from django.db.models import Prefetch

from core.commands.context import issue_context
from core.models import Change, Item, Membership, Tag, Workspace


PAGE_SIZE = 100
CURSOR_TTL = timedelta(days=90)
CURSOR_SALT = "focuspocus.workspace-changes.v1"


class StaleCursor(ValueError):
    pass


def accessible_workspace(user, workspace_id):
    """Caller holds an atomic block. Recheck authority after obtaining the lock."""
    memberships = Membership.objects.filter(user=user, workspace_id=workspace_id)
    workspace = (
        Workspace.objects.select_for_update()
        .filter(pk__in=memberships.values("workspace_id"))
        .first()
    )
    return workspace if workspace is not None and memberships.exists() else None


def cursor_for(workspace, user, revision):
    identity = [str(user.pk), str(workspace.pk), str(workspace.generation), revision]
    return signing.dumps(identity, salt=CURSOR_SALT)


def read_cursor(token, workspace, user):
    if not token or len(token) > 1024:
        raise StaleCursor
    try:
        value = signing.loads(token, salt=CURSOR_SALT, max_age=CURSOR_TTL)
    except signing.BadSignature as error:
        raise StaleCursor from error
    identity = [str(user.pk), str(workspace.pk), str(workspace.generation)]
    if (
        not isinstance(value, list)
        or len(value) != 4
        or value[:3] != identity
        or type(value[3]) is not int
        or not 0 <= value[3] <= workspace.revision
    ):
        raise StaleCursor
    return value[3]


def snapshot(workspace, user):
    tags = Tag.objects.filter(workspace=workspace).order_by("title", "id")
    items = (
        Item.objects.filter(workspace=workspace)
        .order_by("position", "id")
        .prefetch_related(Prefetch("tags", queryset=tags, to_attr="snapshot_tags"))
    )
    projects, tasks = [], []
    for item in items:
        entry = {"id": str(item.pk), "title": item.title, "version": item.version}
        if item.kind == "project":
            projects.append(entry)
        else:
            tasks.append(
                {
                    **entry,
                    "kind": item.kind,
                    "parentId": str(item.parent_id) if item.parent_id else "inbox",
                    "tags": [str(tag.pk) for tag in item.snapshot_tags],
                    "due": item.due.isoformat() if item.due else None,
                    "done": item.done,
                }
            )
    return {
        "workspaceId": str(workspace.pk),
        "generation": str(workspace.generation),
        "revision": workspace.revision,
        "cursor": cursor_for(workspace, user, workspace.revision),
        "context": issue_context(workspace, user),
        "projects": projects,
        "tasks": tasks,
        "tags": list(tags.values("id", "title", "version")),
    }


def changes_since(workspace, user, token, limit):
    after = read_cursor(token, workspace, user)
    end = min(workspace.revision, after + limit)
    changes = list(
        Change.objects.filter(workspace=workspace, revision__gt=after, revision__lte=end)
        .order_by("revision")
        .values("revision", "affected")
    )
    if [row["revision"] for row in changes] != list(range(after + 1, end + 1)):
        raise StaleCursor
    return {
        "changes": changes,
        "cursor": cursor_for(workspace, user, end),
        "revision": end,
        "more": end < workspace.revision,
    }
