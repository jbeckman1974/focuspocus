"""Translate source scalar properties and explain information that cannot be preserved."""

import json
import re
from datetime import datetime

from core.commands.validation import CommandError, title
from core.content.notes import validate_document
from core.scheduling.dates import DateIntent, MAX_DURATION_MINUTES
from core.scheduling.repeat_rule import RepeatRule


def boolean(raw):
    if raw.lower() in ("", "true", "yes", "1"):
        return True
    if raw.lower() in ("false", "no", "0"):
        return False
    raise ValueError("Expected true or false.")


def date_intent(raw):
    if raw.startswith("{"):
        return DateIntent.from_wire(json.loads(raw)).wire()
    date_value = raw.replace(" ", "T", 1)
    if len(raw) == 10:
        kind = "date"
    else:
        kind = "instant" if re.search(r"(Z|[+-]\d{2}:\d{2})$", raw) else "floating"
    return DateIntent.from_wire({"kind": kind, "value": date_value}).wire()


def recurrence(raw):
    value = raw.get("repeat-rule", "")
    if value.startswith("{"):
        result = json.loads(value)
        RepeatRule.from_wire(result)
        return result
    bits = {}
    for clause in value.split(";"):
        key, sep, val = clause.partition("=")
        if not sep or key in bits or key not in {"FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY"}:
            raise ValueError("The recurrence pattern has unsupported or duplicate clauses.")
        bits[key] = val
    units = {"MINUTELY": "minute", "HOURLY": "hour", "DAILY": "day", "WEEKLY": "week", "MONTHLY": "month", "YEARLY": "year"}
    schedules = {"from-assigned": "regular", "from-completion": "completion"}
    methods = {"fixed": ("regular", None), "start-after-completion": ("completion", "defer"),
               "due-after-completion": ("completion", "due")}
    method, anchor = methods[raw.get("repeat-method", "fixed")]
    schedule = schedules[raw["repeat-schedule-type"]] if "repeat-schedule-type" in raw else method
    result = {"unit": units[bits["FREQ"]], "interval": int(bits.get("INTERVAL", "1")), "schedule": schedule}
    if "repeat-anchor-date" in raw:
        anchor = {"dateDue": "due", "dateToStart": "defer", "datePlanned": "planned"}[raw["repeat-anchor-date"]]
    if anchor:
        result["anchor"] = anchor
    if "COUNT" in bits:
        result["count"] = int(bits["COUNT"])
    if "UNTIL" in bits:
        result["endDate"] = datetime.strptime(bits["UNTIL"], "%Y%m%d").date().isoformat()
    if "BYDAY" in bits:
        result["weekdays"] = ["MO TU WE TH FR SA SU".split().index(day) for day in bits["BYDAY"].split(",")]
    if "BYMONTHDAY" in bits:
        result["monthDays"] = [int(day) for day in bits["BYMONTHDAY"].split(",")]
    RepeatRule.from_wire(result)
    return result


def convert(item, warn):
    raw = item.pop("rawFields")
    values = item["fields"]
    aliases = {"repeat rule": "repeat-rule", "repeat method": "repeat-method", "repeat anchor date": "repeat-anchor-date",
               "repeat schedule type": "repeat-schedule-type"}
    raw = {aliases.get(k, k): v for k, v in raw.items()}
    note = "\n".join(item.pop("notes"))
    try:
        item["title"] = title(item["title"])
        if note:
            validate_document({"paragraphs": [[{"text": line}] for line in note.split("\n")]})
            values["note"] = note
    except CommandError as error:
        warn("text", "invalid", str(error))
    for key, val in raw.items():
        try:
            if key in ("due", "defer", "planned"):
                values.setdefault("schedule", {})[key] = date_intent(val)
            elif key in ("flagged", "autodone"):
                values["flagged" if key == "flagged" else "autoComplete"] = boolean(val)
            elif key in ("parallel", "mode"):
                mode = ("parallel" if boolean(val) else "sequential") if key == "parallel" else val.lower()
                if mode not in {"parallel", "sequential", "single-action"}:
                    raise ValueError("Unknown project mode.")
                values["mode"] = mode
            elif key in ("done", "completed at", "dropped at"):
                if key != "completed at" or "status" not in raw:
                    values["status"] = "dropped" if key == "dropped at" else "completed"
                if val:
                    intent = date_intent(val)
                    values["droppedAt" if key == "dropped at" else "completedAt"] = intent
                    if intent["kind"] != "instant":
                        warn(key, "transformed", "The workspace timezone resolves this local status date.")
            elif key == "status":
                status = {"on hold": "held", "done": "completed", "available": "active"}.get(val.lower(), val.lower())
                if status not in {"active", "held", "completed", "dropped"}:
                    raise ValueError("Unknown direct status.")
                values["status"] = status
            elif key in ("tags", "context"):
                names = list(dict.fromkeys(title(tag) for tag in val.split(",") if tag.strip()))
                if len(names) > 64:
                    raise ValueError("Too many tags for a single item.")
                values["tags"] = names
            elif key in ("estimate", "duration"):
                parts = re.fullmatch(r"(\d+)\s*(m|min|h|d|w)?", val.strip(), re.I)
                if not parts:
                    raise ValueError("Unsupported duration.")
                unit = (parts[2] or "m").lower()
                minutes = int(parts[1]) * {"m": 1, "min": 1, "h": 60, "d": 1440, "w": 10080}[unit]
                if minutes > MAX_DURATION_MINUTES:
                    raise ValueError("Duration exceeds the supported maximum.")
                values["durationMinutes"] = minutes
            elif key == "position":
                position = int(val)
                if not 0 <= position < 2**63:
                    raise ValueError("Unsupported sibling position.")
                values["position"] = position
            elif key not in ("repeat-anchor-date", "repeat-method", "repeat-rule", "repeat-schedule-type"):
                warn(key, "unsupported", f"Field omitted. Source excerpt: {val[:120]}")
        except (ValueError, KeyError, IndexError, CommandError):
            warn(key, "unsupported", f"Value omitted. Source excerpt: {val[:120]}")
    if any(k.startswith("repeat-") for k in raw):
        try:
            values["repeat"] = recurrence(raw)
        except (ValueError, KeyError, IndexError, TypeError):
            warn("repeat", "unsupported", "Cannot reconstruct this recurrence. The item will have no repeat rule.")
    if "mode" in values and (item["kind"] not in {"project", "group"} or
                             values["mode"] == "single-action" and item["kind"] != "project"):
        del values["mode"]
        warn("mode", "unsupported", "This item kind does not support the supplied mode.")
    if values.get("autoComplete") and (item["kind"] not in {"project", "group"} or values.get("mode") == "single-action"):
        del values["autoComplete"]
        warn("autodone", "unsupported", "Auto-completion is unavailable for this item.")
    if values.get("status") == "held" and item["kind"] != "project" or values.get("status") == "completed" and item["kind"] == "folder":
        warn("status", "invalid", "This status cannot be represented for this item kind.")
