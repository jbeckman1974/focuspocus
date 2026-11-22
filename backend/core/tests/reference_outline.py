"""The ordered 42-item acceptance outline in docs/VERIFICATION_PLAN.md."""

from datetime import date, datetime
from uuid import uuid5
from zoneinfo import ZoneInfo


ZONE = ZoneInfo("America/New_York")
FIXTURE_TIME = datetime(2026, 11, 21, 10, tzinfo=ZONE)
CREATED_TIME = datetime(2026, 11, 1, 9, tzinfo=ZONE)
CHILDREN = {
    "root": ("F01 Office", "P03 Punch list", "P05 Instrument rounds"),
    "inbox": ("I01 Loose receipt", "I02 Untagged insert", "I03 Pretagged insert"),
    "F01": ("F02 Field jobs", "P02 Plan sheets", "P06 Weekly review"),
    "F02": ("P01 Control traverse", "P04 Permit wait"),
    "P01": ("A01 Clear gate", "A02 Mark station", "G01 Tie shots", "A05 File return"),
    "G01": ("A03 East tie", "A04 West tie"),
    "P02": ("G02 Sign-off", "A08 Cross-check", "G03 Staging"),
    "G02": ("A06 Draft sheet", "A07 Sign sheet"),
    "G03": ("A09 Blank child", "A10 Fixed child"),
    "P03": ("A11 Battery", "A12 Photos", "A13 Café ledger"),
    "P04": ("A14 Check permit",),
    "P05": ("G04 Cases", "A17 Close cabinet"),
    "G04": ("A15 Open case", "A16 Gauge check"),
    "P06": (
        "A18 Bench route", "A19 Signed page", "A20 Obsolete form", "A21 Bench wait",
        "A22 Daily check", "A23 Relative check", "A24 Calendar edge", "A25 Spare case",
        "A26 Capacity", "A27 Outlet",
    ),
}
KINDS = {"A": "action", "I": "action", "F": "folder", "P": "project", "G": "group"}
MODES = {"P01": "sequential", "G02": "sequential", "G04": "sequential", "P03": "single-action"}
RESOLVED = {
    "A19": ("completed", datetime(2026, 11, 10, 10, tzinfo=ZONE)),
    "A20": ("dropped", datetime(2026, 11, 9, 10, tzinfo=ZONE)),
}
CALENDAR_DUE = {"A10": date(2026, 11, 25), "A18": date(2026, 11, 25), "G03": date(2026, 11, 30)}
DIRECT_TAGS = {
    "Desk": ("I03", "A26"),
    "Field": ("A18", "A27", "A21"),
    "Wait": ("A21",),
    "Reference": ("G03",),
}


def fixture_id(workspace, key):
    """The same fixture label maps to a distinct UUID in each workspace."""
    return uuid5(workspace.pk, "focuspocus/reference/" + key)


def seed_outline(workspace):
    """Seed M3A hierarchy, direct flags, modes, statuses, calendar due dates and tags."""
    from core.models import Item, ItemTag, Tag

    items = {}
    for parent_key, titles in CHILDREN.items():
        parent = None if parent_key in {"inbox", "root"} else items[parent_key]
        for position, title in enumerate(titles, start=1):
            key = title.split(" ", 1)[0]
            status, changed = RESOLVED.get(key, ("held" if key == "P04" else "active", CREATED_TIME))
            items[key] = Item.objects.create(
                id=fixture_id(workspace, key),
                workspace=workspace,
                parent=parent,
                position=position * 1024,
                title=title,
                kind=KINDS[key[0]],
                mode=MODES.get(key),
                auto_complete=key in {"G01", "G02"},
                flagged=key in {"G03", "A10", "A26"},
                due=CALENDAR_DUE.get(key),
                disposition="active" if status == "completed" else status,
                done=status == "completed",
                created_at=CREATED_TIME,
                changed_at=changed,
                completed_at=changed if status == "completed" else None,
                dropped_at=changed if status == "dropped" else None,
            )
    tags = {}
    for name in ("Venue", "Desk", "Field", "Reference", "Wait"):
        tags[name] = Tag.objects.create(
            id=fixture_id(workspace, name),
            workspace=workspace,
            title=name,
            parent=tags["Venue"] if name in {"Desk", "Field"} else None,
            exclusive=name == "Venue",
            status="held" if name == "Wait" else "active",
        )
    # G03 gains its tag after the children exist; A09/A10 have no direct copy.
    for name, labels in DIRECT_TAGS.items():
        ItemTag.objects.bulk_create([
            ItemTag(workspace=workspace, item=items[label], tag=tags[name]) for label in labels
        ])
    return {key: str(item.pk) for key, item in items.items()}
