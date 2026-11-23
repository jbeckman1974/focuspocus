"""Exercise a post-backup shared membership revocation through the ordinary HTTP API."""

import secrets
import uuid

from django.contrib.auth import get_user_model
from django.test import Client

from core.auth_services import provision_account
from core.commands.context import issue_context
from core.models import Membership


class Actor:
    def __init__(self, user):
        self.browser = Client(HTTP_HOST="localhost", enforce_csrf_checks=True)
        self.browser.force_login(user)
        self.headers = {"HTTP_X_FOCUSPOCUS_ACTOR": str(user.pk),
                        "HTTP_X_CSRFTOKEN": self.browser.get("/api/v1/session").json()["csrfToken"]}

    def request(self, path, data=None, status=200):
        route = "/api/v1/" + path
        response = (self.browser.get(route, **self.headers) if data is None else
                    self.browser.post(route, data, content_type="application/json", **self.headers))
        if response.status_code != status:
            raise RuntimeError(f"Recovery membership check expected HTTP {status}, received {response.status_code}.")
        return response.json()


def prepare():
    suffix = uuid.uuid4().hex
    owner = provision_account("qa-recovery-owner-" + suffix, secrets.token_urlsafe(32))
    member = provision_account("qa-recovery-editor-" + suffix, secrets.token_urlsafe(32))
    manager, editor = Actor(owner), Actor(member)
    workspace = str(uuid.uuid4())
    manager.request("sharing/workspaces", {"id": workspace, "name": "Recovery fixture"})
    shared = f"workspaces/{workspace}/sharing/"
    invitation = manager.request(shared + "invites", {
        "username": member.username, "role": "editor", "expectedVersion": manager.request(shared)["version"],
    })
    editor.request("sharing/accept", {"token": invitation["token"]})
    editor.request(f"workspaces/{workspace}/snapshot")
    grant = Membership.objects.get(workspace_id=workspace, user=member, role="editor")
    return {"workspace": workspace, "owner": owner.pk, "member": member.pk, "incarnation": str(grant.incarnation)}


def revoke(record):
    """Match the exact grant, apply the owner's revocation and check access using fresh sessions."""
    workspace, member_id = record["workspace"], record["member"]
    current = Membership.objects.select_related("workspace", "user").get(
        workspace_id=workspace, user_id=member_id, role="editor"
    )
    if str(current.incarnation) != record["incarnation"]:
        raise RuntimeError("The independent grant record refers to another membership.")
    # Model a queued write for this incarnation without admitting a restored editor session.
    pending_context = issue_context(current.workspace, current.user)
    users = get_user_model().objects
    manager = Actor(users.get(pk=record["owner"]))
    base = f"workspaces/{workspace}/"
    roster = base + "sharing/"
    version = manager.request(roster)["version"]
    manager.request(roster + f"members/{member_id}", {"role": None, "expectedVersion": version})
    snapshot = manager.request(base + "snapshot")
    editor = Actor(current.user)
    editor.request(base + "snapshot", status=404)
    editor.request(base + "commands/capture", {
        "operationId": str(uuid.uuid4()), "context": pending_context, "expectedRevision": snapshot["revision"],
        "payload": {"parentId": "inbox", "items": [{"id": str(uuid.uuid4()), "title": "Revoked write fixture"}]},
    }, status=404)
    if any(w["id"] == workspace for w in editor.request("sharing/workspaces")["workspaces"]):
        raise RuntimeError("The revoked shared workspace is still listed.")
