"""Only the caller's personal settings are portable. Live devices and credentials stay unbound."""
from uuid import uuid4, uuid5

from core.commands.validation import CommandError, fields, identifier, title
from core.lifecycle_models import OrganizationPreference
from core.perspectives.definition import ICONS, id_list, validate_definition
from core.perspectives.models import PerspectiveState, SavedPerspective
from core.preferences.models import AccountPreference, DevicePreference
from core.preferences.settings import update_account, update_device


def personal_settings(workspace, actor, adapters=None):
    if adapters is None:
        from core.integrations.portable import export_settings
        adapters = export_settings(workspace, actor)
    state = PerspectiveState.objects.filter(workspace=workspace, user=actor).first()
    views = state.perspectives.order_by("view_id").values("view_id", "name", "favorite", "icon", "definition") if state else []
    return {
        "reminders": adapters["reminders"], "calendars": adapters["calendars"],
        "focus": state.focus_ids if state else [], "views": list(views),
        "account": AccountPreference.objects.filter(user=actor).values_list("values", flat=True).first() or {},
        "cleanup": OrganizationPreference.objects.filter(user=actor).values_list("resolved_cleanup", flat=True).first() or "on-cleanup",
        "devices": list(DevicePreference.objects.filter(workspace=workspace, user=actor).order_by("device").values("device", "values")),
    }


def reference(maps, namespace, kind, key):
    # A missing source must still match nothing. Clearing a stale focus would show every row.
    if key not in maps[kind]:
        return str(uuid5(namespace, f"{kind}:{key}"))
    return str(maps[kind][key])


def replace_rule_ids(raw, maps, namespace):
    result, _ = validate_definition(raw)
    result["scopeIds"] = [reference(maps, namespace, "items", key) for key in result["scopeIds"]]
    stack = [result["expression"]]
    while stack:
        node = stack.pop()
        if "field" in node:
            if node["field"] in ("tag", "contains"):
                kind = "tags" if node["field"] == "tag" else "items"
                node["value"] = reference(maps, namespace, kind, node["value"])
        else:
            stack.extend(next(iter(node.values())))
    return result


def restore_personal(workspace, actor, data, maps, apply_account):
    fields(data, ["focus", "views", "account", "cleanup", "devices", "reminders", "calendars"])
    focus = [reference(maps, workspace.generation, "items", key) for key in id_list(data["focus"])]
    state = PerspectiveState.objects.create(workspace=workspace, user=actor, focus_ids=focus)
    if not isinstance(data["views"], list) or not isinstance(data["devices"], list):
        raise ValueError("Invalid personal settings.")
    view_ids = set()
    for view in data["views"]:
        fields(view, ["view_id", "name", "favorite", "icon", "definition"])
        key = identifier(view["view_id"])
        if key in view_ids or view["icon"] not in ICONS or type(view["favorite"]) is not bool:
            raise ValueError("Invalid saved perspective.")
        view_ids.add(key)
        SavedPerspective.objects.create(state=state, view_id=uuid4(), name=title(view["name"]),
                                        icon=view["icon"], favorite=view["favorite"], definition=replace_rule_ids(view["definition"], maps, workspace.generation))
    for device in data["devices"]:
        fields(device, ["device", "values"])
        # A layout is nonsecret, scoped to the actor and tied to its browser's existing device UUID.
        DevicePreference.objects.create(workspace=workspace, user=actor, device=identifier(device["device"]),
                                        values=update_device({}, device["values"]))
    account = data["account"]
    if isinstance(account, dict) and account.get("dateDefaults") == {}:
        account = {k: v for k, v in account.items() if k != "dateDefaults"}
    settings = update_account({}, account)
    if data["cleanup"] not in ("immediate", "on-cleanup"):
        raise CommandError("Invalid cleanup preference.")
    if apply_account:
        record, _ = AccountPreference.objects.select_for_update().get_or_create(user=actor)
        record.version += 1
        record.values = settings
        record.save(update_fields=["values", "version"])
        OrganizationPreference.objects.update_or_create(user=actor, defaults={"resolved_cleanup": data["cleanup"]})
