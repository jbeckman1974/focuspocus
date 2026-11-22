"""Inspect real CSV headers and preserve record boundaries, quoted text and source IDs."""

import csv
import io
import re

from core.commands.validation import CommandError

from .source import MAX_ISSUES, MAX_ROWS, issue, row


ALIASES = {"task id": "id", "item id": "id", "parentid": "parent id", "name": "title", "task": "title",
           "type": "kind", "task type": "kind", "task name": "title", "notes": "note", "flag": "flagged",
           "defer date": "defer", "planned date": "planned", "due date": "due", "start date": "defer",
           "completion date": "completed at", "date completed": "completed at", "tag": "tags",
           "estimated time": "estimate", "duration minutes": "duration", "task status": "status",
           "outline depth": "depth"}
KINDS = {"task": "action", "inbox": "action", "action group": "group", "project": "project", "folder": "folder",
         "group": "group", "action": "action"}


def header(value):
    value = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value)
    name = " ".join(value.strip().lower().replace("_", " ").replace("-", " ").split())
    return ALIASES.get(name, name)


def read(text):
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    rows, issues, ids, depths = [], [], {}, []
    try:
        keys = [header(s) for s in next(reader, [])]
        if not keys or not all(keys) or len(keys) != len(set(keys)) or "title" not in keys or len(keys) > 100:
            return [], [issue(1, "header", "invalid", "Supply unique, nonempty columns including Title or Name (maximum 100 columns).")]
        while True:
            number = reader.line_num + 1
            values = next(reader, None)
            if values is None:
                break
            if not values:
                continue
            if len(values) != len(keys):
                issues.append(issue(number, "columns", "invalid", "The record length differs from the header."))
                continue
            data = dict(zip(keys, values))
            raw_kind = data.pop("kind", "action").strip().lower()
            kind = KINDS.get(raw_kind, "action")
            if raw_kind not in KINDS:
                issues.append(issue(number, "kind", "ambiguous", "Unknown item kind; preview uses action."))
            item = row(number, data.pop("title"), kind, source_id=data.pop("id", "").strip())
            item["parentKey"] = data.pop("parent id", "").strip()
            note = data.pop("note", "")
            if note:
                item["notes"] = note.split("\n")
            raw_depth = data.pop("depth", "")
            if raw_depth:
                if not re.fullmatch(r"[0-9]{1,3}", raw_depth) or int(raw_depth) > len(depths):
                    issues.append(issue(number, "depth", "invalid", "Depth jumps across a missing parent."))
                else:
                    depth = int(raw_depth)
                    del depths[depth:]
                    item["parentLine"] = depths[-1] if depths else None
                    depths.append(number)
            if item["sourceId"]:
                if item["sourceId"] in ids:
                    issues.append(issue(number, "id", "invalid", "Source ID occurs more than once."))
                ids[item["sourceId"]] = number
            item["rawFields"] = {k: v for k, v in data.items() if v != ""}
            rows.append(item)
            if len(rows) > MAX_ROWS or len(issues) > MAX_ISSUES:
                raise CommandError("Too many rows or diagnostics in one import.", 413)
    except csv.Error as error:
        issues.append(issue(reader.line_num, "CSV", "invalid", str(error)))
    for item in rows:
        key = item.pop("parentKey")
        if key and key.lower() not in ("root", "inbox"):
            if key not in ids:
                issues.append(issue(item["line"], "parent id", "invalid", "Parent ID is outside this selection."))
            else:
                item["parentLine"] = ids[key]
    return rows, issues
