import re

from core.commands.validation import CommandError, fields, identifier
from core.models import Item, Tag

from .models import CalendarConnection, Reminder, TagPlace
from .places import coordinates
from .reminders import timestamp


def export_settings(workspace, user):
    places = TagPlace.objects.filter(tag__workspace=workspace).order_by("tag_id")
    result = {"schema": 1, "places": [{"tagId": str(p.tag_id), "latitude": p.latitude,
                                      "longitude": p.longitude, "radiusMeters": p.radius_meters} for p in places],
              "reminders": [], "calendars": []}
    if user is not None:
        result["reminders"] = [{"id": str(r.public_id), "itemId": str(r.item_id), "at": r.at.isoformat(),
                                "status": r.status} for r in Reminder.objects.filter(
                                    workspace=workspace, user=user, item__workspace=workspace).order_by("pk")]
        result["calendars"] = [{"source": key} for key in CalendarConnection.objects.filter(
            workspace=workspace, user=user).order_by("source").values_list("source", flat=True)]
    return result


def destination(mapping, value):
    source = str(identifier(value))
    dest = mapping.get(source)
    if dest is None:
        raise CommandError("Unknown object in integration settings.")
    return getattr(dest, "pk", dest)


def restore_settings(workspace, user, data, item_ids, tag_ids):
    fields(data, ["schema", "places", "reminders", "calendars"])
    if type(data["schema"]) is not int or data["schema"] != 1:
        raise CommandError("Unsupported integration settings version.")
    if any(not isinstance(data[k], list) for k in ("places", "reminders", "calendars")):
        raise CommandError("Invalid integration settings.")
    if user is None and (data["calendars"] or data["reminders"]):
        raise CommandError("Personal settings need an owner.")
    for place in data["places"]:
        fields(place, ["tagId", "latitude", "longitude", "radiusMeters"])
        tag = Tag.objects.filter(workspace=workspace, pk=destination(tag_ids, place["tagId"])).first()
        if not tag:
            raise CommandError("Unknown place tag.")
        TagPlace.objects.create(tag=tag, **coordinates(place))
    for reminder in data["reminders"]:
        fields(reminder, ["id", "itemId", "at", "status"])
        item = Item.objects.filter(workspace=workspace, pk=destination(item_ids, reminder["itemId"])).first()
        if not item or reminder["status"] not in ("scheduled", "paused", "cancelled", "due"):
            raise CommandError("Invalid restored reminder.")
        status = "cancelled" if reminder["status"] == "cancelled" else "paused"
        Reminder.objects.create(workspace=workspace, user=user, item=item, public_id=identifier(reminder["id"]),
                                at=timestamp(reminder["at"]), status=status)
    for connection in data["calendars"]:
        fields(connection, ["source"])
        key = connection["source"]
        if not isinstance(key, str) or not re.fullmatch(r"[\w.-]{1,80}", key, re.ASCII):
            raise CommandError("Invalid restored calendar.")
        CalendarConnection.objects.create(workspace=workspace, user=user, source=key, status="disconnected")
