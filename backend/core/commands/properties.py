"""Change direct outline properties with the same receipt as the enclosing command."""

from core.rules.properties import mode_for

from .completion import apply_status, validate_status
from .state import Changes, save_changed
from .validation import CommandError, fields


MODES = {"parallel", "sequential", "single-action"}
STATES = {"active", "held", "completed", "dropped"}


def choice(value, choices, label):
    if not isinstance(value, str) or value not in choices:
        raise CommandError(f"Unknown {label}.")
    return value


def validate(item, payload):
    for key in ("flagged", "autoComplete"):
        if key in payload and type(payload[key]) is not bool:
            raise CommandError(f"{key} must be true or false.")
    if "mode" in payload:
        mode = choice(payload["mode"], MODES, "container mode")
        if item.kind not in ("project", "group") or (mode == "single-action" and item.kind != "project"):
            raise CommandError("This item does not support the chosen mode.")
    if "autoComplete" in payload and item.kind not in ("project", "group"):
        raise CommandError("Only a project or group can complete with its last action.")
    mode = payload.get("mode", mode_for(item))
    if mode == "single-action" and payload.get("autoComplete", False):
        raise CommandError("Single-action lists cannot complete with their last action.")
    if "status" in payload:
        status = choice(payload["status"], STATES, "status")
        validate_status(item, status)


def set_properties(tree, data):
    fields(data, ["ids"], ["mode", "status", "flagged", "autoComplete"])
    if len(data) == 1:
        raise CommandError("Choose a property to change.")
    items = tree.selected(data["ids"])
    for item in items:
        validate(item, data)
    result = Changes([str(item.pk) for item in items])
    for item in items:
        properties = {}
        if "mode" in data and mode_for(item) != data["mode"]:
            properties["mode"] = data["mode"]
        if "flagged" in data:
            properties["flagged"] = data["flagged"]
        if data.get("mode") == "single-action":
            properties["auto_complete"] = False
        elif "autoComplete" in data:
            properties["auto_complete"] = data["autoComplete"]
        save_changed(item, result, **properties)
    if "status" in data:
        apply_status(tree, result, items, data["status"])
    if set(data) != {"ids", "status"}:
        result.inverse.clear()
    return result
