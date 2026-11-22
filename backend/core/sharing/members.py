"""Membership administration, serialized by the same workspace lock as task mutations."""

from datetime import timedelta
import secrets

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from core.auth_services import digest
from core.commands.service import scoped_workspace
from core.commands.validation import CommandError, fields, identifier, title
from core.models import Change, Membership, Workspace

from .models import CaptureCredential, SharedWorkspace, WorkspaceInvitation


def workspaces_for(user):
    rows = Membership.objects.filter(user=user).values_list(
        "workspace_id", "workspace__private_owner_id", "workspace__sharedworkspace__name", "role"
    )
    workspaces = [
        {"id": str(pk), "private": owner is not None, "name": name or ("Private workspace" if owner else "Shared workspace"),
         "role": role} for pk, owner, name, role in rows
    ]
    return {"workspaces": sorted(workspaces, key=lambda row: (not row["private"], row["name"].casefold(), row["id"]))}


@transaction.atomic
def create_shared(user, body):
    fields(body, ["id", "name"])
    pk, name = identifier(body["id"]), title(body["name"])
    workspace, created = Workspace.objects.select_for_update().get_or_create(pk=pk)
    if created:
        SharedWorkspace.objects.create(workspace=workspace, name=name)
        Membership.objects.create(workspace=workspace, user=user, role="owner")
    elif (workspace.private_owner_id is not None
          or not Membership.objects.filter(workspace=workspace, user=user, role="owner").exists()
          or not SharedWorkspace.objects.filter(workspace=workspace, name=name).exists()):
        raise CommandError("Workspace identifier unavailable.", 409)
    return {"workspaceId": str(pk), "name": name}


def roster(user, workspace_id):
    workspace = scoped_workspace(user, workspace_id)
    role = Membership.objects.get(workspace=workspace, user=user).role
    shared = SharedWorkspace.objects.filter(workspace=workspace).first()
    private = workspace.private_owner_id is not None
    result = {"workspaceId": str(workspace.pk), "private": private, "role": role,
              "name": shared.name if shared else ("Private workspace" if private else "Shared workspace"),
              "version": shared.version if shared else 0, "members": [], "invites": []}
    if private or role != "owner":
        return result
    result["members"] = [
        {"userId": pk, "username": username, "role": member_role}
        for pk, username, member_role in Membership.objects.filter(workspace=workspace)
        .order_by("user__username").values_list("user_id", "user__username", "role")
    ]
    result["invites"] = [
        {"id": str(invite.pk), "username": invite.recipient.get_username(), "role": invite.role,
         "expiresAt": invite.expires_at.isoformat()}
        for invite in WorkspaceInvitation.objects.filter(workspace=workspace, generation=workspace.generation,
                                                         expires_at__gt=timezone.now())
        .select_related("recipient").order_by("recipient__username")
    ]
    return result


def managed_space(user, workspace_id, expected):
    workspace = scoped_workspace(user, workspace_id, owner=True)
    if workspace.private_owner_id is not None:
        raise CommandError("Create a shared workspace to invite others.", 403)
    shared = SharedWorkspace.objects.filter(workspace=workspace).first()
    if shared is None:
        raise CommandError("Shared workspace unavailable.", 404)
    if type(expected) is not int or expected != shared.version:
        raise CommandError("Membership changed. Refresh the roster before continuing.", 409)
    return shared


def advance(shared, *, membership_changed=False):
    shared.version += 1
    shared.save(update_fields=["version"])
    if membership_changed:
        workspace = shared.workspace
        workspace.revision += 1
        workspace.save(update_fields=["revision"])
        Change.objects.create(workspace=workspace, revision=workspace.revision, affected=[])


def invite_role(value):
    if value not in ("editor", "viewer"):
        raise CommandError("Choose editor or viewer.")
    return value


def issue_invitation(user, workspace_id, body):
    fields(body, ["username", "role", "expectedVersion"])
    shared = managed_space(user, workspace_id, body["expectedVersion"])
    role = invite_role(body["role"])
    username = title(body["username"])
    recipient = get_user_model().objects.filter(username=username, is_active=True).first()
    if recipient is None or Membership.objects.filter(workspace_id=workspace_id, user=recipient).exists():
        raise CommandError("Choose an existing account outside this workspace.")
    # A replacement issues a fresh identifier so an old revoke cannot cancel the new invitation.
    WorkspaceInvitation.objects.filter(workspace_id=workspace_id, recipient=recipient).delete()
    token = secrets.token_urlsafe(32)
    invitation = WorkspaceInvitation.objects.create(workspace=shared.workspace, generation=shared.workspace.generation,
        recipient=recipient, role=role, digest=digest(token), expires_at=timezone.now() + timedelta(days=7))
    advance(shared)
    return {"id": str(invitation.pk), "token": token, "expiresAt": invitation.expires_at.isoformat()}


def revoke_invitation(user, workspace_id, invitation_id, body):
    fields(body, ["expectedVersion"])
    shared = managed_space(user, workspace_id, body["expectedVersion"])
    deleted, _ = WorkspaceInvitation.objects.filter(workspace_id=workspace_id, pk=invitation_id).delete()
    if not deleted:
        raise CommandError("Invitation unavailable.", 404)
    advance(shared)
    return {"revoked": True}


def accept_invitation(user, body):
    fields(body, ["token"])
    token = body["token"]
    if not isinstance(token, str) or not token.isascii() or len(token) != 43:
        raise CommandError("Invitation unavailable or expired.", 404)
    eligible = WorkspaceInvitation.objects.filter(recipient=user, digest=digest(token))
    workspace = Workspace.objects.select_for_update().filter(
        pk__in=eligible.values("workspace_id"), private_owner__isnull=True
    ).first()
    invite = (eligible.filter(workspace=workspace, generation=workspace.generation,
                              expires_at__gt=timezone.now()).first() if workspace else None)
    if invite is None:
        raise CommandError("Invitation unavailable or expired.", 404)
    if Membership.objects.filter(user=user, workspace=workspace).exists():
        raise CommandError("Account already has access.", 409)
    Membership.objects.create(user=user, workspace=workspace, role=invite.role)
    invite.delete()
    advance(SharedWorkspace.objects.get(workspace=workspace), membership_changed=True)
    return {"workspaceId": str(workspace.pk), "role": invite.role}


def change_member(user, workspace_id, target_id, body):
    fields(body, ["role", "expectedVersion"])
    shared = managed_space(user, workspace_id, body["expectedVersion"])
    member = Membership.objects.filter(workspace_id=workspace_id, user_id=target_id).first()
    if member is None:
        raise CommandError("Member unavailable.", 404)
    if member.role == "owner":
        raise CommandError("The workspace owner retains ownership.", 403)
    role = body["role"]
    if role is not None:
        invite_role(role)
    if role != member.role:
        if role != "editor":
            CaptureCredential.objects.filter(workspace_id=workspace_id, user_id=target_id).delete()
        if role is None:
            from core.integrations.membership import revoke_personal
            revoke_personal(shared.workspace, member.user)
            member.delete()
        else:
            member.role = role
            member.save(update_fields=["role"])
        advance(shared, membership_changed=True)
    return {"userId": target_id, "role": role}
