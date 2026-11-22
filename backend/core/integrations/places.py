import hashlib
import json

from core.commands.context import validate_context
from core.commands.validation import CommandError, fields, identifier
from core.models import Change, Receipt, Tag
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


def write_location(workspace, user, body):
    """The endpoint holds the workspace lock after rechecking its editor membership."""
    if not isinstance(body, dict):
        raise CommandError("Send a tag place.")
    if "expectedVersion" not in body:
        raise CommandError("The current tag version is required.", 428)
    remove = body.get("remove") is True
    required = ["context", "operationId", "expectedVersion", "tagId"]
    fields(body, required + (["remove"] if remove else ["latitude", "longitude", "radiusMeters"]))
    version = body["expectedVersion"]
    if type(version) is not int or version < 1:
        raise CommandError("Expected a positive tag version.")
    identity = dict(workspace=workspace, actor=user, context_id=validate_context(workspace, user, body["context"]),
                    operation_id=identifier(body["operationId"]))
    message = json.dumps(["tag-place", body], sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(message.encode()).hexdigest()
    prior = Receipt.objects.filter(**identity).values_list("fingerprint", flat=True).first()
    if prior is not None:
        if prior != fingerprint:
            raise CommandError("This operation identifier was used for different input.", 409)
        return
    tag = Tag.objects.filter(workspace=workspace, pk=identifier(body["tagId"])).first()
    if tag is None:
        raise CommandError("Tag unavailable.", 404)
    if tag.version != version:
        raise CommandError("This tag changed. Refresh and compare the saved place.", 409)
    place = TagPlace.objects.filter(tag=tag).first()
    values = {} if remove else coordinates(body)
    changed = place is not None if remove else place is None or any(
        getattr(place, field) != value for field, value in values.items())
    if changed:
        if remove:
            place.delete()
        else:
            TagPlace.objects.update_or_create(tag=tag, defaults=values)
        tag.version += 1
        tag.save(update_fields=["version"])
        workspace.revision += 1
        workspace.save(update_fields=["revision"])
        Change.objects.create(workspace=workspace, revision=workspace.revision, affected=[str(tag.pk)])
    Receipt.objects.create(**identity, fingerprint=fingerprint, result={"tagVersion": tag.version})


def locations(workspace, user, body=None):
    if body is not None:
        write_location(workspace, user, body)
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
        result.append({"tagId": key, "version": place.tag.version, "title": place.tag.title, "latitude": place.latitude,
                       "longitude": place.longitude, "radiusMeters": place.radius_meters,
                       "itemIds": [row["id"] for row in items if scoped.intersection(row["tags"])]})
    return {"places": result, "revision": workspace.revision}
