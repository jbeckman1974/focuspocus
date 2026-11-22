"""Decode each portable field with its domain validator and allocate fresh typed IDs."""
from datetime import datetime
import re
from urllib.parse import quote
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from core.commands.filing import POLICIES
from core.commands.validation import fields, identifier, title
from core.content.files import file_name
from core.content.notes import validate_document
from core.planning.models import UNITS
from core.repeats.models import OUTCOMES
from core.repeats.schedule_changes import validate_rule_schedule
from core.scheduling.dates import DateContext, direct_dates, duration_minutes
from core.scheduling.repeat_rule import RepeatRule

from .records import TABLES


def decoded_field(field, value):
    if value is None:
        if not field.null:
            raise ValueError("A required record field is empty.")
        return None
    if isinstance(field, models.JSONField):
        return value
    if isinstance(field, models.BooleanField):
        if type(value) is not bool:
            raise ValueError("Invalid boolean field.")
    elif isinstance(field, models.IntegerField):
        if type(value) is not int:
            raise ValueError("Invalid numeric field.")
    elif not isinstance(value, str):
        raise ValueError("Invalid text or date field.")
    try:
        result = field.to_python(value)
        field.run_validators(result)
    except (ValidationError, OverflowError) as error:
        raise ValueError("Invalid record field.") from error
    if isinstance(result, datetime) and timezone.is_naive(result):
        raise ValueError("Historical timestamps require a timezone.")
    return result


def check_row(table, row):
    if table.name == "items":
        title(row["title"])
        direct_dates(row["schedule"])
        duration_minutes(row["duration_minutes"])
        if row["kind"] not in ("action", "group", "project", "folder") or row["shelf"] not in ("active", "archive", "trash"):
            raise ValueError("Unknown item type or shelf.")
    elif table.name == "tags":
        title(row["title"])
        if row["status"] not in ("active", "held", "dropped"):
            raise ValueError("Unknown tag status.")
    elif table.name == "series":
        RepeatRule.from_wire(row["rule"])
        direct_dates(row["origin"])
    elif table.name == "occurrences":
        if row["outcome"] not in OUTCOMES:
            raise ValueError("Invalid occurrence outcome.")
        if row["applied_rule"] is not None:
            RepeatRule.from_wire(row["applied_rule"])
    elif table.name == "reviews" and (row["unit"] not in UNITS or not 1 <= row["interval"] <= 999):
        raise ValueError("Invalid review interval.")
    elif table.name == "notes":
        row["document"], row["plain_text"] = validate_document(row["document"])
    elif table.name == "files":
        file_name(quote(row["filename"], safe=""))
    elif table.name == "blobs":
        if not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
            raise ValueError("Invalid file digest.")


def check_graph(rows, parent_field):
    # Mark each node once even for deep lists; avoid recursion on imported data.
    parents = {row["id"]: row[parent_field] for row in rows}
    visited = set()
    for current in parents:
        path = set()
        while current is not None and current not in visited:
            if current in path or current not in parents:
                raise ValueError("Cyclic or missing parent.")
            path.add(current)
            current = parents[current]
        visited.update(path)


def decode_records(records):
    fields(records, ["workspace", "history", "imports", "memberships", "personal", "places", "reviewSources", *[t.name for t in TABLES]])
    workspace = fields(records["workspace"], ["name", "timeZone", "dateDefaults", "filingPolicy"])
    title(workspace["name"])
    clock = DateContext(workspace["timeZone"], timezone.now(), workspace["dateDefaults"])
    if workspace["filingPolicy"] not in POLICIES:
        raise ValueError("Unknown filing policy.")
    groups = {}
    maps = {}
    for table in TABLES:
        rows = records[table.name]
        if not isinstance(rows, list) or len(rows) > 200_000:
            raise ValueError("Unsupported record count.")
        columns = table.fields()
        model_fields = {f.attname: f for f in table.model._meta.concrete_fields}
        converted = []
        identities = {}
        for data in rows:
            fields(data, columns)
            row = {}
            for key in columns:
                field = model_fields[key]
                if field.is_relation:
                    row[key] = None if data[key] is None and field.null else str(identifier(data[key]))
                else:
                    row[key] = decoded_field(field, data[key])
            if "id" in row:
                key = str(row["id"])
                if key != data["id"] or key in identities:
                    raise ValueError("Duplicate or noncanonical record identity.")
                identities[key] = uuid4()
                row["id"] = key
            if table.name == "items":
                for key in ("shelf_root", "shelf_before"):
                    if row[key] is not None:
                        row[key] = str(row[key])
            check_row(table, row)
            converted.append(row)
        groups[table.name] = converted
        maps[table.name] = identities
    for name, reference in (("items", "parent_id"), ("tags", "parent_id"), ("occurrences", "predecessor_id")):
        check_graph(groups[name], reference)
    items = {row["id"]: row for row in groups["items"]}
    series = {row["id"]: row for row in groups["series"]}
    for occurrence in groups["occurrences"]:
        template = series[occurrence["series_id"]]
        if template["active"] and occurrence["outcome"] == "open":
            item = items[occurrence["item_id"]]
            validate_rule_schedule(RepeatRule.from_wire(template["rule"]), item["schedule"], clock, template["origin"])
    for row in items.values():
        parent = items.get(row["parent_id"])
        if row["shelf"] == "active" and parent:
            allowed = ("folder",) if row["kind"] in ("folder", "project") else ("group", "project")
            if parent["shelf"] != "active" or parent["kind"] not in allowed:
                raise ValueError("Invalid outline placement.")
        if row["shelf"] == "active":
            if row["shelf_root"] is not None or row["shelf_before"] is not None:
                raise ValueError("Active item has removed-shelf placement.")
        else:
            root = items.get(row["shelf_root"])
            if root is None or root["shelf_root"] != root["id"] or root["shelf"] != row["shelf"]:
                raise ValueError("Invalid removed subtree.")
        if row["filing_project_id"] is not None and items.get(row["filing_project_id"], {}).get("kind") != "project":
            raise ValueError("Invalid filing project.")
    for row in groups["reviews"]:
        if items.get(row["project_id"], {}).get("kind") != "project":
            raise ValueError("Review requires a project.")
    for table in TABLES:
        for row in groups[table.name]:
            if "id" in row:
                row["id"] = maps[table.name][row["id"]]
            for field, target in table.references:
                key = row[field]
                if key is None:
                    continue
                if field == "shelf_before" and key not in maps[target]:
                    # A removed anchor falls back to the original position on retrieval.
                    row[field] = None
                elif key not in maps[target]:
                    raise ValueError("A portable reference has no destination.")
                else:
                    row[field] = maps[target][key]
    return groups, maps
