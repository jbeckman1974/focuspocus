"""Version and replay personal edits under the same membership lock as shared commands."""

import hashlib
import json

from core.commands.context import validate_context
from core.commands.validation import CommandError, fields, identifier, title
from core.models import Item, Receipt, Tag
from .definition import ICONS, check_references, choice, id_list, validate_definition
from .models import PerspectiveState, SavedPerspective


def personal_state(user, workspace):
    return PerspectiveState.objects.filter(user=user, workspace=workspace).first()


def serialize(state):
    if state is None:
        return {"personalVersion": 0, "focusIds": [], "perspectives": []}
    perspectives = [
        {"id": str(record.view_id), "version": record.version, "name": record.name,
         "icon": record.icon, "favorite": record.favorite, "definition": record.definition}
        for record in state.perspectives.order_by("-favorite", "name", "view_id")
    ]
    return {"personalVersion": state.version, "focusIds": state.focus_ids, "perspectives": perspectives}


def validate_targets(workspace, refs):
    item_keys = refs["scope"] | refs["contains"]
    items = [{"id": str(key), "kind": kind} for key, kind in
             Item.objects.filter(workspace=workspace, shelf="active", pk__in=item_keys).values_list("pk", "kind")]
    tags = [{"id": str(key)} for key in
            Tag.objects.filter(workspace=workspace, pk__in=refs["tag"]).values_list("pk", flat=True)]
    check_references(refs, items, tags)


def apply(state, action, payload):
    if action == "focus":
        fields(payload, ["ids"])
        keys = id_list(payload["ids"])
        validate_targets(state.workspace, {"scope": set(keys), "contains": set(), "tag": set()})
        changed = keys != state.focus_ids
        state.focus_ids = keys
        return changed
    if action == "delete":
        fields(payload, ["id"])
        removed, _ = state.perspectives.filter(view_id=identifier(payload["id"])).delete()
        if not removed:
            raise CommandError("Perspective unavailable.", 404)
        return True
    if action != "save":
        raise CommandError("Unknown personal action.", 404)
    fields(payload, ["id", "name", "favorite", "icon", "definition"])
    if type(payload["favorite"]) is not bool:
        raise CommandError("Expected a favorite setting.")
    definition, refs = validate_definition(payload["definition"])
    validate_targets(state.workspace, refs)
    key = identifier(payload["id"])
    record = state.perspectives.filter(view_id=key).first()
    values = {"name": title(payload["name"]), "favorite": payload["favorite"],
              "icon": choice(payload["icon"], ICONS, "icon"), "definition": definition}
    if record is None:
        SavedPerspective.objects.create(state=state, view_id=key, **values)
        return True
    if all(getattr(record, field) == value for field, value in values.items()):
        return False
    for field, value in values.items():
        setattr(record, field, value)
    record.version += 1
    record.save(update_fields=[*values, "version"])
    return True


def write(user, workspace, body):
    fields(body, ["context", "operationId", "expectedVersion", "action", "payload"])
    identity = {"workspace": workspace, "actor": user, "context_id": validate_context(workspace, user, body["context"]),
                "operation_id": identifier(body["operationId"])}
    signature = json.dumps(["personal-perspective-v1", body], sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(signature.encode()).hexdigest()
    prior = Receipt.objects.filter(**identity).first()
    if prior:
        if prior.fingerprint != fingerprint:
            raise CommandError("Operation identifier already used.", 409)
        return prior.result
    state, _ = PerspectiveState.objects.get_or_create(user=user, workspace=workspace)
    expected = body["expectedVersion"]
    if type(expected) is not int or expected < 0:
        raise CommandError("Expected a nonnegative personal version.")
    if expected != state.version:
        raise CommandError("Personal views changed. Refresh and compare your edits.", 409)
    if apply(state, body["action"], body["payload"]):
        state.version += 1
        state.save(update_fields=["focus_ids", "version"])
    result = serialize(state)
    Receipt.objects.create(**identity, fingerprint=fingerprint, result=result)
    return result
