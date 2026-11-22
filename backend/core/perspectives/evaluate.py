"""Evaluate validated rules using the same effective fields as the standard outline."""

from datetime import datetime
from zoneinfo import ZoneInfo

from core.queries.outline import FILTERS, tag_scope
from .focus import descendants


def calendar_day(row, field, zone):
    entry = row["effective"]["schedule"].get(field)
    if not entry:
        return None
    if entry["value"]["kind"] == "date":
        return entry["value"]["value"]
    return datetime.fromisoformat(entry["instant"]).astimezone(zone).date().isoformat()


def within(value, limits, low, high):
    return (value is not None and (low not in limits or value >= limits[low])
            and (high not in limits or value <= limits[high]))


class Evaluation:
    def __init__(self, rows, tags, order, notes, zone):
        self.rows = rows
        self.items = {row["id"]: row for row in rows}
        self.tags = tags
        self.tag_by_id = {tag["id"]: tag for tag in tags}
        self.order = {row["id"]: (root, project) for row, root, project, _ in order}
        self.notes = notes
        self.zone = ZoneInfo(zone)

    def includes_text(self, row, needle):
        texts = [row["title"], self.notes.get(row["id"], "")]
        seen = set()
        for key in row["tags"]:
            while key in self.tag_by_id and key not in seen:
                seen.add(key)
                tag = self.tag_by_id[key]
                texts.append(tag["title"])
                key = tag["parentId"]
        return any(needle in text.casefold() for text in texts)

    def predicate(self, node):
        if "field" not in node:
            operator, children = next(iter(node.items()))
            tests = [self.predicate(child) for child in children]
            if operator == "all":
                return lambda row: all(test(row) for test in tests)
            if operator == "any":
                return lambda row: any(test(row) for test in tests)
            return lambda row: not any(test(row) for test in tests)

        field, value = node["field"], node["value"]
        if field == "tag":
            matching = tag_scope(self.tags, value) if value in self.tag_by_id else set()
            return lambda row: not matching.isdisjoint(row["tags"])
        if field == "contains":
            branch = descendants(self.rows, [value]) - {value}
            return lambda row: row["id"] in branch
        if field == "text":
            needle = value.casefold()
            return lambda row: self.includes_text(row, needle)
        if field == "availability":
            return lambda row: row["effective"][FILTERS[value]]
        if field in ("status", "flagged"):
            return lambda row: row["effective"][field] == value
        if field == "kind":
            return lambda row: row["kind"] == value
        if field == "repeating":
            return lambda row: bool(row["repeat"] and row["repeat"]["active"]) == value
        if field == "inbox":
            return lambda row: (self.order[row["id"]][0] == "inbox") == value
        if field == "singleAction":
            return lambda row: (self.items.get(self.order[row["id"]][1], {}).get("mode") == "single-action") == value
        if field == "duration":
            return lambda row: within(row["durationMinutes"], value, "min", "max")
        if type(value) is bool:
            return lambda row: (field in row["effective"]["schedule"]) == value
        return lambda row: within(calendar_day(row, field, self.zone), value, "from", "through")
