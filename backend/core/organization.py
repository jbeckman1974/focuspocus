"""Personal outline preferences, shared by the same account's browsers."""

from core.commands.state import Changes
from core.commands.validation import CommandError, fields
from core.models import OrganizationPreference


def cleanup_mode(user):
    mode = OrganizationPreference.objects.filter(user=user).values_list("resolved_cleanup", flat=True).first()
    return mode or "on-cleanup"


def set_cleanup(user, data):
    fields(data, ["mode"])
    mode = data["mode"]
    if mode not in ("on-cleanup", "immediate"):
        raise CommandError("Choose a resolved item cleanup mode.")
    OrganizationPreference.objects.update_or_create(user=user, defaults={"resolved_cleanup": mode})
    # Personal preferences neither modify the shared outline nor enter its undo history.
    return Changes([])
