"""Run each command under the same lock as its authorization and receipt."""

import hashlib
import json

from django.db import transaction

from core.access import locked_membership
from core import organization
from core.content.commands import content_command
from core.models import Change, Receipt
from core.history.recording import recording
from core.history.restore import reverse
from core.planning import review
from core.preferences.bulk import apply_bulk
from core.repeats import commands as repeats

from . import edits, lifecycle, properties, schedules
from .context import validate_context
from .state import Outline
from .structure import organize
from .validation import CommandError, fields, identifier


def scoped_workspace(user, workspace_id, *, write=False, owner=False):
    if not user.is_authenticated:
        raise CommandError("Login required.", 401)
    workspace, role = locked_membership(user, workspace_id)
    if workspace is None:
        raise CommandError("Workspace unavailable.", 404)
    if owner and role != "owner":
        raise CommandError("Workspace owner permission required.", 403)
    if write and role not in ("owner", "editor"):
        raise CommandError("Write permission required.", 403)
    return workspace


def etag(item):
    return f'"item-{item.pk}-v{item.version}"'


def dispatch(tree, user, name, payload):
    if name in ("set-note", "remove-file"):
        return content_command(tree, name, payload)
    if name in ("set-review", "mark-reviewed"):
        return review.command(tree, user, name, payload)
    if name == "bulk-inspect":
        return apply_bulk(tree, user, payload)
    if name == "set-resolved-cleanup":
        return organization.set_cleanup(user, payload)
    if name in ("create-container", "create-tag"):
        return edits.create_entry(tree, name, payload)
    if name == "set-schedule":
        return schedules.set_schedule(tree, payload, user=user)
    if name == "set-date-settings":
        return schedules.set_date_settings(tree, payload)
    if name in repeats.COMMANDS:
        return repeats.dispatch(tree, name, payload)
    if name == "set-properties":
        return properties.set_properties(tree, payload)
    if name in lifecycle.COMMANDS:
        return lifecycle.dispatch(tree, name, payload)
    if name == "capture":
        return edits.capture(tree, payload)
    if name == "bulk-edit":
        return edits.edit(tree, payload, user=user)
    if name == "set-tags":
        return edits.set_tags(tree, payload)
    if name in ("complete", "reopen"):
        return edits.complete(tree, name, payload)
    if name in ("undo", "redo"):
        return reverse(tree, user, name, payload, edits.undo)
    if name in ("move", "reorder", "indent", "outdent", "group"):
        return organize(tree, name, payload)
    raise CommandError("Unknown command.", 404)


@transaction.atomic
def execute(user, workspace_id, name, body, *, item_id=None, if_match=None, command_handler=None):
    workspace = scoped_workspace(user, workspace_id, write=True, owner=name == "set-date-settings")
    fields(body, ["operationId", "context", "payload"], ["expectedRevision"])
    op = identifier(body["operationId"])
    context = validate_context(workspace, user, body["context"])
    identity = dict(workspace=workspace, actor=user, operation_id=op, context_id=context)
    serialized = json.dumps([name, str(item_id), if_match, body], sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    prior = Receipt.objects.filter(**identity).first()
    if prior is not None:
        if prior.fingerprint != fingerprint:
            raise CommandError("Operation key already used for a different request.", 409)
        return prior.result
    tree = Outline(workspace)
    payload = body["payload"]
    with recording(workspace) as history:
        if item_id is not None:
            item = tree.get(item_id)
            if not if_match:
                raise CommandError("A strong If-Match version is required.", 428)
            if if_match != etag(item):
                raise CommandError("This item has changed. Reload and compare the draft.", 412)
            fields(payload, optional=["title", "due"])
            result = edits.edit(tree, {**payload, "ids": [str(item_id)]}, user=user)
        else:
            if "expectedRevision" not in body:
                raise CommandError("A workspace revision is required.", 428)
            version = body["expectedRevision"]
            if type(version) is not int or version < 0:
                raise CommandError("Expected a nonnegative integer revision.")
            if workspace.revision != version:
                raise CommandError("The workspace changed. Reload and compare the draft.", 409)
            if command_handler is None:
                result = dispatch(tree, user, name, payload)
            else:
                result = command_handler(tree, payload)
        if result.versions:
            inverse = history.finish(name)
            if inverse:
                result.inverse = inverse
    if result.versions:
        workspace.revision += 1
        workspace.save(update_fields=["revision"])
        Change.objects.create(workspace=workspace, revision=workspace.revision, affected=list(result.versions))
    response = {
        "operationId": str(op), "contextId": str(context), "revision": workspace.revision,
        "versions": result.versions, "selection": result.selection, "undoable": bool(result.inverse),
    }
    Receipt.objects.create(**identity, fingerprint=fingerprint, result=response, inverse=result.inverse)
    return response
