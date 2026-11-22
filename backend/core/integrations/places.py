from core.commands.validation import CommandError, fields, identifier
from core.models import Tag
from core.perspectives.focus import focused_ids
from core.queries.outline import tag_scope
from core.queries.records import read_records

from .models import TagPlace


def coordinates(body):
    def number(key, limit):
        value = body[key]
        if type(value) not in (int, float) or not -limit <= value <= limit:
            raise CommandError("Enter a valid geographic coordinate.")
        return float(value)
    radius = body["radiusMeters"]
    if type(radius) is not int or not 1 <= radius <= 100_000:
        raise CommandError("Enter a radius from 1 to 100000 meters.")
    return dict(latitude=number("latitude", 90), longitude=number("longitude", 180), radius_meters=radius)


def locations(workspace, user, body=None):
    if body is not None:
        if not isinstance(body, dict):
            raise CommandError("Send a tag place.")
        remove = body.get("remove") is True
        fields(body, ["tagId", "remove"] if remove else ["tagId", "latitude", "longitude", "radiusMeters"])
        tag = Tag.objects.filter(workspace=workspace, pk=identifier(body["tagId"])).first()
        if tag is None:
            raise CommandError("Tag unavailable.", 404)
        if remove:
            TagPlace.objects.filter(tag=tag).delete()
        else:
            TagPlace.objects.update_or_create(tag=tag, defaults=coordinates(body))
    places = TagPlace.objects.filter(tag__workspace=workspace).select_related("tag").order_by("tag__title", "tag_id")
    rows, tags, _ = read_records(workspace)
    focus = focused_ids(workspace, user, rows)
    tags_by_id = {t["id"]: t for t in tags}
    available = []
    for tag in tags:
        current = tag
        while current and current["status"] == "active":
            current = tags_by_id.get(current["parentId"])
        if current is None:
            available.append(tag["id"])
    active = set(available)
    items = [row for row in rows if row["kind"] == "action" and row["effective"]["available"]
             and (focus is None or row["id"] in focus)]
    result = []
    for place in places:
        key = str(place.tag_id)
        scoped = tag_scope(tags, key) & active
        result.append({"tagId": key, "title": place.tag.title, "latitude": place.latitude,
                       "longitude": place.longitude, "radiusMeters": place.radius_meters,
                       "itemIds": [row["id"] for row in items if scoped.intersection(row["tags"])]})
    return {"places": result}
