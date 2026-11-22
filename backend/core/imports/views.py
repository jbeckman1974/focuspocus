"""Authenticated owner endpoints for bounded previews and replay-safe batch transitions."""

from hashlib import sha256
import json

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods, require_POST, require_GET

from core.commands.context import validate_context
from core.commands.service import scoped_workspace
from core.commands.validation import CommandError, fields, identifier
from core.commands.views import read_body
from core.models import Receipt

from .commit import commit
from .models import ImportBatch
from .rollback import rollback
from .source import MAX_BYTES
from .staging import preview, stage, summary


def batch_for(workspace, batch_id):
    try:
        return ImportBatch.objects.get(workspace=workspace, pk=batch_id)
    except ImportBatch.DoesNotExist as error:
        raise CommandError("Import batch unavailable.", 404) from error


@never_cache
@require_http_methods(["GET", "POST"])
def collection(request, workspace_id):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id, owner=True)
            if request.method == "GET":
                batches = ImportBatch.objects.filter(workspace=workspace).order_by("-created_at").defer("rows", "issues", "guard", "conflicts")[:100]
                return JsonResponse({"batches": [summary(b) for b in batches]})
            if request.content_type != "application/octet-stream":
                raise CommandError("Send the original file as application/octet-stream.", 415)
            if set(request.GET) != {"format"} or len(request.GET.getlist("format")) != 1:
                raise CommandError("Specify one import format.")
            raw = request.read(MAX_BYTES + 1)
            if not 0 < len(raw) <= MAX_BYTES:
                raise CommandError("Supply a nonempty file of at most 512 KiB.", 413)
            return JsonResponse(preview(workspace, stage(workspace, raw, request.GET["format"])))
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)


@never_cache
@require_GET
def detail(request, workspace_id, batch_id):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id, owner=True)
            return JsonResponse(preview(workspace, batch_for(workspace, batch_id)))
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)


def transition(user, workspace, batch, action, data):
    fields(data, ["context", "operationId", "expectedRevision"])
    revision = data["expectedRevision"]
    if type(revision) is not int or revision < 0:
        raise CommandError("Expected a nonnegative workspace revision.")
    identity = {"actor": user, "workspace": workspace, "context_id": validate_context(workspace, user, data["context"]),
                "operation_id": identifier(data["operationId"])}
    fingerprint = sha256(json.dumps(["import", str(batch.pk), action, revision]).encode()).hexdigest()
    ack = Receipt.objects.filter(**identity).first()
    if ack:
        if ack.fingerprint != fingerprint:
            raise CommandError("This operation identifier was used for different input.", 409)
        return JsonResponse(preview(workspace, batch))
    if workspace.revision != revision:
        raise CommandError("The workspace changed. Refresh the preview before continuing.", 409)
    if action == "rollback" and batch.status == "committed":
        blocked = rollback(workspace, batch)
        if blocked:
            return JsonResponse({"error": "Later changes prevent rollback.", "conflicts": blocked}, status=409)
    elif action == "commit" and batch.status == "staged":
        if not preview(workspace, batch)["canCommit"]:
            raise CommandError("Resolve the invalid source rows before committing.", 409)
        commit(workspace, batch)
    elif action == "abort" and batch.status == "staged":
        batch.rows, batch.issues, batch.status = [], [], "aborted"
        batch.save(update_fields=["rows", "issues", "status"])
    elif batch.status != {"rollback": "rolled_back", "commit": "committed", "abort": "aborted"}[action]:
        raise CommandError("This batch cannot perform the requested transition.", 409)
    Receipt.objects.create(**identity, fingerprint=fingerprint, result={"importBatch": str(batch.pk), "status": batch.status})
    return JsonResponse(preview(workspace, batch))


@never_cache
@require_POST
def action(request, workspace_id, batch_id, mode):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id, owner=True)
            return transition(request.user, workspace, batch_for(workspace, batch_id), mode, read_body(request))
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
