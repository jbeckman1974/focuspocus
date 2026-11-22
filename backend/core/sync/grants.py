"""Membership identity shared by signed command contexts and change cursors."""

from datetime import timedelta
from uuid import uuid5

from django.utils import timezone

from core.commands.validation import CommandError
from core.models import Membership


PROTOCOL = 1
RETENTION = timedelta(days=90)


def grant_id(workspace, user):
    member = (Membership.objects.filter(workspace=workspace, user=user)
              .values_list("pk", "role", "role_epoch").first())
    if member is None:
        raise CommandError("Workspace unavailable.", 404)
    member_id, role, epoch = member
    return str(uuid5(workspace.generation, f"{workspace.pk}/{user.pk}/{member_id}/{role}/{epoch}"))


def claims(workspace, user, grant):
    return [PROTOCOL, str(user.pk), str(workspace.pk), str(workspace.generation), grant]


def descriptor(grant):
    # Django signs integer-second timestamps. Round down to keep the advertised
    # offline deadline within the validity of the subsequently issued context.
    deadline = timezone.now().replace(microsecond=0) + RETENTION
    return {"id": grant, "protocol": PROTOCOL, "expiresAt": deadline.isoformat()}
