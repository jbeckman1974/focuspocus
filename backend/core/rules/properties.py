"""Direct item settings shared by commands and workspace projections."""

from datetime import datetime, timezone


def mode_for(item):
    if item.kind in ("project", "group"):
        return item.mode or "parallel"
    return None


def status_updates(status, *, now=None):
    if status not in ("active", "held", "completed", "dropped"):
        raise ValueError("Unknown item status")
    now = now or datetime.now(timezone.utc)
    return {
        "done": status == "completed",
        "disposition": status if status in ("held", "dropped") else "active",
        "completed_at": now if status == "completed" else None,
        "dropped_at": now if status == "dropped" else None,
    }
