"""Workspace reads taken under the same revision lock as command commits."""

from django.core import signing

from core.commands.context import issue_context
from core.content.files import file_limit
from core.models import Change
from core.organization import cleanup_mode
from core.perspectives.focus import perspective_version, snapshot_focus
from core.preferences.settings import date_defaults
from core.queries.records import read_records
from . import grants


PAGE_SIZE = 100
CURSOR_TTL = grants.RETENTION
CURSOR_SALT = "focuspocus.workspace-changes.v2"


class StaleCursor(ValueError):
    pass


def cursor_for(workspace, user, revision, *, grant=None):
    grant = grant if grant is not None else grants.for_member(workspace, user)
    return signing.dumps([*grants.claims(workspace, user, grant), revision], salt=CURSOR_SALT)


def read_cursor(token, workspace, user, grant):
    if not token or len(token) > 1024:
        raise StaleCursor
    try:
        value = signing.loads(token, salt=CURSOR_SALT, max_age=CURSOR_TTL)
    except signing.BadSignature as error:
        raise StaleCursor from error
    identity = grants.claims(workspace, user, grant)
    if (
        not isinstance(value, list)
        or len(value) != len(identity) + 1
        or value[:-1] != identity
        or type(value[-1]) is not int
        or not 0 <= value[-1] <= workspace.revision
    ):
        raise StaleCursor
    return value[-1]


def snapshot(workspace, user, view_zone=None):
    grant = grants.for_member(workspace, user)
    rows, tags, metadata = read_records(workspace, view_zone)
    return {
        "workspaceId": str(workspace.pk),
        "maxFileBytes": file_limit(),
        "assignmentDueTime": date_defaults(workspace, user)["due"],
        "generation": str(workspace.generation),
        "revision": workspace.revision,
        "offlineGrant": grants.descriptor(grant),
        "cursor": cursor_for(workspace, user, workspace.revision, grant=grant),
        "context": issue_context(workspace, user, grant=grant),
        "projects": [row for row in rows if row["kind"] == "project"],
        "folders": [row for row in rows if row["kind"] == "folder"],
        "tasks": [row for row in rows if row["kind"] in ("group", "action")],
        "tags": tags,
        "filingPolicy": workspace.filing_policy,
        "resolvedCleanup": cleanup_mode(user),
        **snapshot_focus(workspace, user),
        **metadata,
    }


def changes_since(workspace, user, token, limit):
    grant = grants.for_member(workspace, user)
    after = read_cursor(token, workspace, user, grant)
    end = min(workspace.revision, after + limit)
    changes = list(
        Change.objects.filter(workspace=workspace, revision__gt=after, revision__lte=end)
        .order_by("revision")
        .values("revision", "affected", "removed")
    )
    if [row["revision"] for row in changes] != list(range(after + 1, end + 1)):
        raise StaleCursor
    return {
        "changes": changes,
        "resolvedCleanup": cleanup_mode(user),
        "perspectiveVersion": perspective_version(workspace, user),
        "cursor": cursor_for(workspace, user, end, grant=grant),
        "revision": end,
        "more": end < workspace.revision,
    }
