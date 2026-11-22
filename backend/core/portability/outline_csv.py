"""Export the active outline in its manual order, with spreadsheet-safe display cells."""
from collections import defaultdict
import csv
import json

from django.http import HttpResponse
from core.commands.validation import CommandError, identifiers
from core.content.models import ItemNote
from core.models import Item, ItemTag
from core.scheduling.storage import read_schedule

COLUMNS = ("id", "parentId", "kind", "position", "title", "status", "tags", "defer", "planned", "due", "note")


def display_cell(value):
    # Spreadsheet importers can trim spaces or treat an initial control as a formula.
    if value.startswith(("\t", "\r", "\n")) or value.lstrip().startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠")):
        return "'" + value
    return value


def outline_csv(workspace, selected):
    wanted = set(identifiers(selected)) if selected else None
    rows = list(Item.objects.filter(workspace=workspace, shelf="active").order_by("position", "id"))
    if wanted and not wanted.issubset({row.id for row in rows}):
        raise CommandError("A selected outline row is unavailable.", 404)
    children = defaultdict(list)
    tags = defaultdict(list)
    for row in rows:
        children[row.parent_id].append(row)
    for item, label in ItemTag.objects.filter(workspace=workspace).order_by("tag__title", "tag_id").values_list("item_id", "tag__title"):
        tags[item].append(label)
    notes = dict(ItemNote.objects.filter(workspace=workspace).values_list("item_id", "plain_text"))
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="focuspocus-outline.csv"'
    response["X-Content-Type-Options"] = "nosniff"
    writer = csv.writer(response)
    writer.writerow(COLUMNS)
    stack = list(reversed(children[None]))
    count = 0
    while stack:
        row = stack.pop()
        stack.extend(reversed(children[row.id]))
        if wanted is not None and row.id not in wanted:
            continue
        schedule = read_schedule(row)
        dates = [json.dumps(schedule[key], ensure_ascii=False, sort_keys=True) if key in schedule else ""
                 for key in ("defer", "planned", "due")]
        writer.writerow((row.id, row.parent_id or "", row.kind, row.position, display_cell(row.title), row.status,
                         json.dumps(tags[row.id], ensure_ascii=False), *dates, display_cell(notes.get(row.id, ""))))
        count += 1
    response["X-Row-Count"] = str(count)
    return response
