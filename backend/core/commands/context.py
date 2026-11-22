from uuid import uuid4

from django.core import signing

from core.sync import grants
from .validation import CommandError, identifier


SALT = "focuspocus.workspace-write.v2"
MAX_AGE_SECONDS = int(grants.RETENTION.total_seconds())


def issue_context(workspace, user, *, grant=None):
    grant = grant if grant is not None else grants.for_member(workspace, user)
    return signing.dumps([*grants.claims(workspace, user, grant), str(uuid4())], salt=SALT)


def validate_context(workspace, user, token):
    if not isinstance(token, str) or len(token) > 1024:
        raise CommandError("Refresh the workspace before writing.", 410)
    try:
        value = signing.loads(token, salt=SALT, max_age=MAX_AGE_SECONDS)
    except signing.BadSignature as error:
        raise CommandError("Refresh the workspace before writing.", 410) from error
    expected = grants.claims(workspace, user, grants.for_member(workspace, user))
    if not isinstance(value, list) or len(value) != len(expected) + 1 or value[:-1] != expected:
        raise CommandError("Refresh the workspace before writing.", 410)
    return identifier(value[-1])
