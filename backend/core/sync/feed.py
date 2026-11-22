"""Workspace reads taken under the same revision lock as command commits."""

from datetime import timedelta

from django.core import signing

from core.commands.context import issue_context
from core.models import Change
from core.organization import cleanup_mode
from core.perspectives.focus import perspective_version
from core.queries.records import read_records


PAGE_SIZE = 100
CURSOR_TTL = timedelta(days=90)
CURSOR_SALT = "focuspocus.workspace-changes.v1"


class StaleCursor(ValueError):
    pass


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


def snapshot(workspace, user, view_zone=None):
    rows, tags, metadata = read_records(workspace, view_zone)
    return {
        "workspaceId": str(workspace.pk),
        "generation": str(workspace.generation),
        "revision": workspace.revision,
        "cursor": cursor_for(workspace, user, workspace.revision),
        "context": issue_context(workspace, user),
        "projects": [row for row in rows if row["kind"] == "project"],
        "folders": [row for row in rows if row["kind"] == "folder"],
        "tasks": [row for row in rows if row["kind"] in ("group", "action")],
        "tags": tags,
        "filingPolicy": workspace.filing_policy,
        "resolvedCleanup": cleanup_mode(user),
        "perspectiveVersion": perspective_version(workspace, user),
        **metadata,
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
        "resolvedCleanup": cleanup_mode(user),
        "perspectiveVersion": perspective_version(workspace, user),
        "cursor": cursor_for(workspace, user, end),
        "revision": end,
        "more": end < workspace.revision,
    }
