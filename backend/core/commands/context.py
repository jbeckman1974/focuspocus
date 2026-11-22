from uuid import uuid4

from django.core import signing

from .validation import CommandError, identifier


SALT = "focuspocus.workspace-write.v1"
MAX_AGE_SECONDS = 90 * 24 * 60 * 60


def issue_context(workspace, user):
    return signing.dumps(
        [str(workspace.pk), str(workspace.generation), str(user.pk), str(uuid4())],
        salt=SALT,
    )


def validate_context(workspace, user, token):
    if not isinstance(token, str) or len(token) > 1024:
        raise CommandError("Refresh the workspace before writing.", 410)
    try:
        claims = signing.loads(token, salt=SALT, max_age=MAX_AGE_SECONDS)
    except signing.BadSignature as error:
        raise CommandError("Refresh the workspace before writing.", 410) from error
    expected = [str(workspace.pk), str(workspace.generation), str(user.pk)]
    if not isinstance(claims, list) or len(claims) != 4 or claims[:3] != expected:
        raise CommandError("Refresh the workspace before writing.", 410)
    return identifier(claims[3])
