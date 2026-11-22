"""Compile a versioned, deterministic plan for review before any outline write."""

from collections import defaultdict
from hashlib import sha256

from core.commands.validation import CommandError
from core.scheduling.recurrence import next_occurrence
from core.scheduling.repeat_rule import RepeatRule
from core.scheduling.storage import merge_schedule

from . import csv_rows, taskpaper
from .source import MAX_ISSUES, identity, issue, source_text
from .values import convert


PARSER_VERSION = 1
ADAPTERS = {"csv": csv_rows, "taskpaper": taskpaper}
COVERAGE = {
    "notes": "Plain note paragraphs are supported. Rich formatting and internal link identity are absent.",
    "attachments": "This text format supplies no attachment bodies.",
    "review": "Historical review events and custom review cadence are outside this text adapter.",
    "perspectives": "Personal perspectives, presentation, reminders and account settings are outside this format.",
    "history": "Change history and prior repeat occurrences cannot be reconstructed from this text.",
    "tags": "Text labels represent root tags. Tag status, geographic data and nested tag identity are unavailable.",
}


def parse(raw, fmt, clock):
    if fmt not in ADAPTERS:
        raise CommandError("Choose CSV or TaskPaper.")
    text, encoding = source_text(raw)
    digest = sha256(raw).hexdigest()
    rows, issues = ADAPTERS[fmt].read(text)
    by_line, children, sources = {r["line"]: r for r in rows}, defaultdict(list), set()
    if not rows:
        issues.append(issue(0, "items", "invalid", "No importable items were found."))
    for item in rows:
        parent = by_line.get(item["parentLine"])
        if parent and parent["kind"] == "action":
            parent["kind"] = "group"
            issues.append(issue(parent["line"], "kind", "transformed", "An action with children becomes a group."))
        children[item["parentLine"]].append(item)
    for item in rows:
        def warn(field, category, message):
            issues.append(issue(item["line"], field, category, message))
        parent = by_line.get(item["parentLine"])
        if parent:
            allowed = ("folder",) if item["kind"] in ("project", "folder") else ("group", "project")
            if parent["kind"] not in allowed:
                warn("parent", "invalid", "The item kind cannot have this parent.")
        ref = item["sourceId"]
        if len(ref) > 500 or ref and ref in sources:
            warn("id", "invalid", "Source ID is too long or duplicated.")
        sources.add(ref)
        item["key"] = identity(fmt, digest, item["line"], ref)
        convert(item, warn)
        fields = item["fields"]
        try:
            if "schedule" in fields:
                fields["schedule"] = merge_schedule({}, fields["schedule"], clock)
            for key, anchor in (("completedAt", "due"), ("droppedAt", "due")):
                if key in fields:
                    from core.scheduling.dates import DateIntent
                    fields[key] = DateIntent.from_wire(fields[key]).instant(anchor, clock).isoformat()
        except (ValueError, OverflowError, TypeError):
            warn("date", "invalid", "The date falls outside the supported workspace calendar.")
        if "repeat" in fields:
            try:
                schedule = fields.get("schedule", {})
                if item["kind"] == "folder" or fields.get("status") in ("completed", "dropped"):
                    raise ValueError
                rule = RepeatRule.from_wire(fields["repeat"])
                next_occurrence(rule, schedule, clock, origin=schedule, remaining=2)
            except (ValueError, OverflowError):
                del fields["repeat"]
                warn("repeat", "unsupported", "The supplied status, anchor or dates do not define a runnable recurrence.")
        if len(issues) > MAX_ISSUES:
            raise CommandError("Too many import diagnostics.", 413)
    if "" in sources:
        issues.append(issue(0, "identity", "ambiguous", "Rows without source IDs are identified by this file and row. A changed export may duplicate them."))
    for siblings in children.values():
        if any("position" in r["fields"] for r in siblings):
            if all("position" in r["fields"] for r in siblings):
                siblings.sort(key=lambda r: r["fields"]["position"])
            else:
                issues.append(issue(siblings[0]["line"], "position", "ambiguous", "Mixed or missing positions; file order is used."))
    ordered, pending = [], list(reversed(children[None]))
    while pending:
        item = pending.pop()
        ordered.append(item)
        pending.extend(reversed(children[item["line"]]))
    if len(ordered) != len(rows):
        issues.append(issue(0, "parent", "invalid", "Parent references contain a cycle or a missing row."))
        ordered = rows
    issues.extend(issue(0, field, "omitted by source", msg) for field, msg in COVERAGE.items())
    return {"rows": ordered, "issues": issues, "encoding": encoding, "sourceSha256": digest,
            "parserVersion": PARSER_VERSION}
