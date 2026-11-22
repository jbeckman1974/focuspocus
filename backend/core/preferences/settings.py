"""Validate user and device settings independently of task data."""

from core.commands.validation import CommandError, fields
from core.scheduling.dates import DEFAULT_TIMES, FIELDS, clock_value

from .models import AccountPreference


ACCOUNT_DEFAULTS = {
    "theme": "system", "density": "comfortable", "textSize": "standard",
    "motion": "system", "editMode": "inline", "shortcut": "x",
}
DEVICE_DEFAULTS = {"sidebarSize": 212, "inspectorSize": 260, "inspectorOpen": None}
CHOICES = {
    "theme": ("system", "light", "dark"), "density": ("compact", "comfortable"),
    "textSize": ("standard", "large"), "motion": ("system", "reduced"),
    "editMode": ("inline", "inspector"), "shortcut": ("x", "c", "k"),
}


def account_values(workspace, raw):
    return {**ACCOUNT_DEFAULTS, **raw, "dateDefaults": {
        **DEFAULT_TIMES, **workspace.date_defaults, **raw.get("dateDefaults", {}),
    }}


def date_defaults(workspace, user):
    values = AccountPreference.objects.filter(user=user).values_list("values", flat=True).first()
    return account_values(workspace, values or {})["dateDefaults"]


def update_account(current, patch):
    fields(patch, optional=[*ACCOUNT_DEFAULTS, "dateDefaults"])
    updated = {**current, **patch}
    for key in patch.keys() & CHOICES.keys():
        if patch[key] not in CHOICES[key]:
            raise CommandError(f"Unsupported {key} choice.")
    if "dateDefaults" in patch:
        clocks = patch["dateDefaults"]
        fields(clocks, optional=FIELDS)
        if not clocks:
            raise CommandError("Choose a date clock to edit.")
        defaults = dict(current.get("dateDefaults", {}))
        for field, value in clocks.items():
            if value is None:
                defaults.pop(field, None)
            else:
                try:
                    clock_value(value)
                except ValueError as error:
                    raise CommandError(str(error)) from error
                defaults[field] = value
        updated["dateDefaults"] = defaults
    return updated


def update_device(current, patch):
    fields(patch, optional=DEVICE_DEFAULTS)
    for key, (minimum, maximum) in {"sidebarSize": (152, 340), "inspectorSize": (190, 400)}.items():
        if key in patch and (type(patch[key]) is not int or not minimum <= patch[key] <= maximum):
            raise CommandError(f"Choose a {key} between {minimum} and {maximum} pixels.")
    if "inspectorOpen" in patch and patch["inspectorOpen"] is not None and type(patch["inspectorOpen"]) is not bool:
        raise CommandError("Inspector visibility must be true, false or automatic.")
    return {**current, **patch}
