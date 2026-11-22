"""Apply a reviewed inverse without overwriting a newer workspace state."""

from django.db.models.deletion import ProtectedError

from core.content.files import check_inverse_capacity, prune_retained
from core.commands.state import Changes
from core.commands.validation import CommandError, fields, identifier
from core.models import Item, Receipt, Tag

from .recording import MODELS, current, row_values


def conflict():
    return CommandError("The workspace changed after this edit. Reload and compare.", 409)


def business_values(values):
    if values is None:
        return None
    return {key: value for key, value in values.items() if key not in {"version", "changed_at"}}


def checked_rows(workspace, journal, revision):
    entries = []
    for entry in journal["rows"]:
        model = MODELS.get(entry["model"])
        if model is None:
            raise conflict()
        obj = model.objects.filter(workspace=workspace, pk=entry["id"]).first()
        actual = row_values(obj) if obj else None
        expected = entry["after"]
        # Redoing or undoing intervening edits advances physical versions. The
        # logical cursor must match in both cases; compare every direct value and edge.
        if workspace.revision == revision:
            valid = actual == expected
        else:
            valid = business_values(actual) == business_values(expected)
        if not valid:
            raise conflict()
        entries.append((model, obj, entry))
    return entries


def restore_fields(obj, values, revision):
    for field in obj._meta.concrete_fields:
        if field.primary_key or field.name == "workspace":
            continue
        if field.attname not in values:
            raise conflict()
        if field.name == "version":
            obj.version = max(obj.version or 0, values["version"], revision) + 1
        else:
            parser = field.target_field if field.is_relation else field
            setattr(obj, field.attname, parser.to_python(values[field.attname]))


def check_destinations(rows, workspace):
    """An original foreign-key destination must still accept the restored edge."""
    planned = {(model, entry["id"]): entry["before"] for model, _, entry in rows}
    for model, _, entry in rows:
        original = entry["before"]
        if original is None:
            continue
        for field in model._meta.concrete_fields:
            if not field.is_relation or field.name == "workspace":
                continue
            target_id = original.get(field.attname)
            if target_id is None:
                continue
            target = field.related_model
            if model._meta.label_lower == "core.projectreview" and field.name == "last_actor":
                # The original reviewer may have since left the workspace or deleted their account.
                if not target.objects.filter(pk=target_id).exists():
                    raise conflict()
                continue
            target_key = (target, str(target_id))
            if target_key in planned:
                destination = planned[target_key]
            else:
                row = target.objects.filter(workspace=workspace, pk=target_id).first()
                destination = row_values(row) if row else None
            if destination is None:
                raise conflict()
            if model is Item and field.name == "parent" and original["shelf"] == "active":
                allowed = {"folder"} if original["kind"] in {"folder", "project"} else {"project", "group"}
                if destination["shelf"] != "active" or destination["kind"] not in allowed:
                    raise conflict()


def check_inbound(rows, workspace):
    # Django's SET_NULL uses a bulk update. Check incoming edges explicitly so
    # a later child, proposed filing, tag or occurrence cannot be silently detached.
    planned = {(model, entry["id"]): entry["before"] for model, _, entry in rows}
    for model, obj, entry in rows:
        if entry["before"] is not None or obj is None:
            continue
        for relation in model._meta.get_fields(include_hidden=True):
            if not relation.auto_created or relation.concrete or not (relation.one_to_one or relation.one_to_many):
                continue
            child_model = relation.related_model
            if child_model not in MODELS.values():
                if child_model.objects.filter(**{relation.field.name: obj}).exists():
                    raise conflict()
                continue
            children = child_model.objects.filter(workspace=workspace, **{relation.field.name: obj})
            for child_id in children.values_list("pk", flat=True):
                child_key = (child_model, str(child_id))
                if child_key not in planned:
                    raise conflict()
                restored = planned[child_key]
                if restored is not None and str(restored.get(relation.field.attname)) == str(obj.pk):
                    raise conflict()


def delete_rows(rows, workspace):
    removals = [(model, obj, entry) for model, obj, entry in rows if entry["before"] is None]
    current().allowed_deletions = {(model._meta.model_name, entry["id"]) for model, _, entry in removals}
    # Remove FK-dependent objects before their targets. Tags protect their
    # parent and may be nested to arbitrary depth; remove leaves first.
    order = ["itemnote", "attachmentlink", "projectreview", "itemtag", "occurrence", "repeatseries", "item", "tag"]
    for model_name in order:
        model = MODELS[model_name]
        ids = {entry["id"] for kind, _, entry in removals if kind is model}
        queryset = model.objects.filter(workspace=workspace, pk__in=ids)
        if model is Tag:
            while queryset.exists():
                parents = set(queryset.exclude(parent=None).values_list("parent_id", flat=True))
                leaves = queryset.exclude(pk__in=parents)
                if not leaves.exists():
                    raise conflict()
                leaves.delete()
        else:
            queryset.delete()


def reverse(tree, user, name, payload, legacy):
    fields(payload, ["operationId", "contextId"])
    workspace = tree.workspace
    receipt = Receipt.objects.filter(workspace=workspace, actor=user,
                                     operation_id=identifier(payload["operationId"]),
                                     context_id=identifier(payload["contextId"])).first()
    if receipt is None:
        raise CommandError("Reversible edit unavailable.", 404)
    journal = receipt.inverse.get("journal")
    if not journal:
        if name == "undo":
            return legacy(tree, user, payload)
        raise CommandError("Reversible edit unavailable.", 404)
    frame = current()
    if (journal["schema"] != 1 or journal["generation"] != str(workspace.generation)
            or journal["end"] != frame.initial or (name == "redo") != (journal["command"] == "undo")):
        raise conflict()
    rows = checked_rows(workspace, journal, receipt.result["revision"])
    check_destinations(rows, workspace)
    check_inbound(rows, workspace)
    restored_files = check_inverse_capacity(workspace, rows)
    result = Changes(receipt.result["selection"])
    for model, obj, entry in rows:
        if obj is not None and entry["before"] is not None:
            restore_fields(obj, entry["before"], workspace.revision)
            obj.save()
            if model in (Item, Tag):
                result.touch(obj)
    try:
        delete_rows(rows, workspace)
    except ProtectedError as error:
        raise conflict() from error
    finally:
        frame.allowed_deletions = None
    for model, obj, entry in rows:
        if entry["before"] is None:
            if model in (Item, Tag):
                result.versions[entry["id"]] = 0
        elif obj is None:
            restored = model(pk=entry["id"], workspace=workspace)
            restore_fields(restored, entry["before"], workspace.revision)
            restored.save(force_insert=True)
            if model in (Item, Tag):
                result.touch(restored)
    if restored_files:
        prune_retained(workspace)
    frame.destination = journal["start"]
    return result
