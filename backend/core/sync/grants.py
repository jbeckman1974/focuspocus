"""Membership identity shared by signed command contexts and change cursors."""

from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid5

from django.utils import timezone

from core.commands.validation import CommandError
from core.models import Membership


PROTOCOL = 1
RETENTION = timedelta(days=90)


@dataclass(frozen=True)
class WorkspaceGrant:
    id: str
    membership_id: str


def for_member(workspace, user):
    member = (Membership.objects.filter(workspace=workspace, user=user)
              .values_list("role", "incarnation").first())
    if member is None:
        raise CommandError("Workspace unavailable.", 404)
    role, incarnation = member
    bound_id = uuid5(workspace.generation, f"{workspace.pk}/{user.pk}/{incarnation}/{role}")
    return WorkspaceGrant(id=str(bound_id), membership_id=str(incarnation))


def claims(workspace, user, grant):
    return [PROTOCOL, str(user.pk), str(workspace.pk), str(workspace.generation), grant.id]


def descriptor(grant):
    # Django signs integer-second timestamps. Round down to keep the advertised
    # offline deadline within the validity of the subsequently issued context.
    deadline = timezone.now().replace(microsecond=0) + RETENTION
    return {"id": grant.id, "membershipId": grant.membership_id, "protocol": PROTOCOL, "expiresAt": deadline.isoformat()}
