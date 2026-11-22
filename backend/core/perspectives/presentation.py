"""Order matching rows for a private presentation without changing manual order."""

import re
from collections import defaultdict
from datetime import datetime

from .evaluate import calendar_day


def natural(text):
    return [int(part) if index % 2 else part.casefold()
            for index, part in enumerate(re.split(r"([0-9]+)", text))]


def ordered(matches, definition):
    sort = definition["sortBy"]
    reverse = definition["direction"] == "desc"
    if sort == "manual":
        return list(reversed(matches)) if reverse else matches

    def value(row):
        if sort == "title":
            return natural(row["title"])
        if sort == "duration":
            return row["durationMinutes"]
        if sort == "changed":
            timestamp = row["changedAt"]
        else:
            timestamp = row["effective"]["schedule"].get(sort, {}).get("instant")
        return datetime.fromisoformat(timestamp) if timestamp else None

    known, unknown = [], []
    for row in matches:
        key = value(row)
        if key is None:
            unknown.append(row)
        else:
            known.append((key, row))
    known.sort(key=lambda pair: pair[0], reverse=reverse)
    return [row for _, row in known] + unknown


def grouping(rows, style, evaluation):
    if style == "none":
        return []
    buckets = defaultdict(list)
    labels = {}
    for row in rows:
        if style == "tag":
            entries = [(key, evaluation.tag_by_id[key]["title"]) for key in row["tags"]] or [("", "No tag")]
        elif style == "project":
            project = evaluation.order[row["id"]][1]
            entries = [(project or "", evaluation.items[project]["title"] if project else "No project")]
        elif style == "due":
            day = calendar_day(row, "due", evaluation.zone)
            entries = [(day or "", day or "No due date")]
        else:
            state = row["effective"]["status"]
            entries = [(state, state.capitalize())]
        for key, label in entries:
            labels[key] = label
            buckets[key].append(row["id"])
    return [{"key": key, "label": labels[key], "ids": buckets[key]}
            for key in sorted(buckets, key=lambda key: (not key, natural(labels[key]), key))]


def visible_rows(page, by_id, layout):
    if layout == "list":
        return [{**row, "context": False} for row in page]
    matching = {row["id"] for row in page}
    seen, result = set(), []
    for row in page:
        chain = []
        while row and row["id"] not in seen:
            seen.add(row["id"])
            chain.append(row)
            row = by_id.get(row["parentId"])
        for entry in reversed(chain):
            result.append({**entry, "context": entry["id"] not in matching})
    return result
