"""Serve authenticated calendar previews and scoped list projections."""

from core.perspectives.focus import focused_ids
from core.scheduling.clock import workspace_clock
from core.scheduling.dates import FIELDS, DateIntent, calendar_zone
from core.commands.validation import CommandError
from core.scheduling.entry import preview_entry

from .outline import options, project_outline
from .records import read_records


def view_zone(params):
    if "viewZone" not in params:
        return None
    if len(params.getlist("viewZone")) != 1:
        raise CommandError("Choose a single view timezone.", 400)
    try:
        return calendar_zone(params["viewZone"])
    except ValueError as error:
        raise CommandError(str(error)) from error


def outline(workspace, params, user=None):
    view, availability, project_id, tag_id, folder_id = options(params)
    rows, tags, metadata = read_records(workspace, view_zone(params))
    eligible = focused_ids(workspace, user, rows) if user is not None else None
    projection = project_outline(rows, tags, view=view, availability=availability, eligible_ids=eligible,
                                 project_id=project_id, tag_id=tag_id, folder_id=folder_id)
    return {"workspaceId": str(workspace.pk), "revision": workspace.revision, **metadata, **projection}


def date_preview(workspace, params, user=None):
    allowed = {"field", "text", "kind", "zone", "fold", "viewZone"}
    if set(params) - allowed or any(len(params.getlist(key)) != 1 for key in params):
        raise CommandError("Invalid date preview options.", 400)
    if params.get("fold", "0") not in ("0", "1"):
        raise CommandError("Choose overlap side 0 or 1.")
    clock = workspace_clock(workspace, view_zone=view_zone(params), user=user)
    try:
        if params.get("kind") == "instant":
            if params.get("field") not in FIELDS or "zone" in params or "fold" in params:
                raise ValueError("A fixed instant requires a schedule field and an explicit offset in the timestamp.")
            intent = DateIntent.from_wire({"kind": "instant", "value": params.get("text")})
            instant = intent.instant(params["field"], clock)
            return {"value": intent.wire(), "instant": instant.isoformat(),
                    "display": instant.astimezone(clock.zone).isoformat(), "zone": clock.zone.key}
        return preview_entry(params.get("text"), params.get("field"), clock,
                             params.get("kind", "floating"), params.get("zone"), int(params.get("fold", "0")))
    except (ValueError, OverflowError) as error:
        raise CommandError(str(error)) from error
