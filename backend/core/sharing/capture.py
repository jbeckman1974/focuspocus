"""Limited Inbox capture grants. A credential grants no read or browser-session authority."""

import secrets
from uuid import uuid4

from django.core import signing
from django.db import transaction

from core.auth_services import digest
from core.commands import edits
from core.commands.context import MAX_AGE_SECONDS
from core.commands.service import scoped_workspace
from core.commands.state import Outline
from core.commands.validation import CommandError, fields, identifier, title
from core.history.recording import recording
from core.models import Change, Membership, Receipt, Workspace

from .models import CaptureAcknowledgement, CaptureCredential


CAPTURE_SALT = "focuspocus.inbox-capture.v1"


def own_credentials(user, workspace_id, body=None):
    workspace = scoped_workspace(user, workspace_id, write=True)
    active = CaptureCredential.objects.filter(workspace=workspace, user=user, generation=workspace.generation)
    if body is None:
        return {"credentials": [{"id": str(pk), "label": label}
                                for pk, label in active.order_by("label", "pk").values_list("pk", "label")]}
    fields(body, ["label"])
    label = title(body["label"])
    if active.filter(label=label).exists():
        raise CommandError("This label is already in use. Revoke the old credential if its token was lost.", 409)
    if active.count() >= 20:
        raise CommandError("Revoke an unused capture credential before adding another.", 409)
    token = secrets.token_urlsafe(32)
    credential = CaptureCredential.objects.create(user=user, workspace=workspace, generation=workspace.generation,
                                                  label=label, digest=digest(token))
    return {"id": str(credential.pk), "label": label, "token": token}


def revoke_credential(user, workspace_id, credential_id, body):
    fields(body)
    workspace = scoped_workspace(user, workspace_id, write=True)
    deleted, _ = CaptureCredential.objects.filter(workspace=workspace, user=user, pk=credential_id).delete()
    if not deleted:
        raise CommandError("Credential unavailable.", 404)
    return {"revoked": True}


def authorized_grant(header):
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.isascii() or len(token) != 43:
        raise CommandError("A current capture credential is required.", 401)
    matches = CaptureCredential.objects.filter(digest=digest(token), user__is_active=True)
    # All membership and credential writers serialize on this same lock. Re-read
    # the grant and the role after acquiring it, including on idempotent retries.
    workspace = Workspace.objects.select_for_update().filter(pk__in=matches.values("workspace_id")).first()
    grant = (matches.filter(workspace=workspace, generation=workspace.generation)
             .select_related("user").first() if workspace else None)
    if grant is None or not Membership.objects.filter(workspace=workspace, user_id=grant.user_id,
                                                       role__in=["owner", "editor"]).exists():
        raise CommandError("A current capture credential is required.", 401)
    return workspace, grant


def claims(workspace, grant):
    return [str(workspace.pk), str(workspace.generation), str(grant.user_id), str(grant.pk)]


@transaction.atomic
def issue_context(header, body):
    fields(body)
    workspace, grant = authorized_grant(header)
    return {"context": signing.dumps(claims(workspace, grant), salt=CAPTURE_SALT)}


def check_context(token, workspace, grant):
    invalid = CommandError("Refresh the capture context.", 410)
    if not isinstance(token, str) or len(token) > 1024:
        raise invalid
    try:
        value = signing.loads(token, salt=CAPTURE_SALT, max_age=MAX_AGE_SECONDS)
    except signing.BadSignature as error:
        raise invalid from error
    if value != claims(workspace, grant):
        raise invalid


@transaction.atomic
def capture(header, body):
    fields(body, ["context", "operationId", "title"])
    workspace, grant = authorized_grant(header)
    check_context(body["context"], workspace, grant)
    operation_id, requested_title = identifier(body["operationId"]), title(body["title"])
    identity = dict(workspace=workspace, actor_id=grant.user_id, context_id=grant.pk, operation_id=operation_id)
    fingerprint = digest(requested_title)
    prior = Receipt.objects.filter(**identity).values_list("fingerprint", "result__selection__0").first()
    if prior is None:
        prior = (CaptureAcknowledgement.objects.filter(credential=grant, operation_id=operation_id)
                 .values_list("fingerprint", "item_id").first())
    if prior is not None:
        saved_fingerprint, saved_item = prior
        if saved_fingerprint != fingerprint:
            raise CommandError("The operation ID belongs to a different capture.", 409)
        return {"operationId": str(operation_id), "itemId": str(saved_item)}
    item_id = str(uuid4())
    with recording(workspace) as journal:
        result = edits.capture(Outline(workspace), {"parentId": "inbox",
                               "items": [{"id": item_id, "title": requested_title}]})
        inverse = journal.finish("capture")
    workspace.revision += 1
    workspace.save(update_fields=["revision"])
    Change.objects.create(workspace=workspace, revision=workspace.revision, affected=list(result.versions))
    Receipt.objects.create(**identity, fingerprint=fingerprint,
                           result={"selection": [item_id], "revision": workspace.revision}, inverse=inverse)
    return {"operationId": str(operation_id), "itemId": item_id}
