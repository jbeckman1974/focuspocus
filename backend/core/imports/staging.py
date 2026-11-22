"""Owner-scoped staging under a locked workspace, with a current duplicate and tag comparison."""

from collections import defaultdict
from hashlib import sha256

from core.commands.validation import CommandError
from core.models import Item, Tag
from core.scheduling.clock import workspace_clock

from .models import ImportBatch, ImportMapping
from .parser import ADAPTERS, PARSER_VERSION, parse
from .source import issue


def summary(batch):
    return {"id": str(batch.pk), "format": batch.source_format, "status": batch.status,
            "sourceSha256": batch.source_hash, "rowCount": batch.row_count}


def stage(workspace, raw, fmt):
    if fmt not in ADAPTERS:
        raise CommandError("Choose CSV or TaskPaper.")
    existing = ImportBatch.objects.filter(workspace=workspace, source_format=fmt, source_hash=sha256(raw).hexdigest(),
                                          status__in=["staged", "committed"]).first()
    if existing:
        return existing
    if ImportBatch.objects.filter(workspace=workspace, status="staged").count() >= 16:
        raise CommandError("Abort an unused preview before staging another file.", 409)
    plan = parse(raw, fmt, workspace_clock(workspace))
    return ImportBatch.objects.create(workspace=workspace, source_format=fmt, source_hash=plan["sourceSha256"],
                                      encoding=plan["encoding"], parser_version=PARSER_VERSION, rows=plan["rows"],
                                      row_count=len(plan["rows"]), issues=plan["issues"])


def bindings(workspace, batch):
    keys = [r["key"] for r in batch.rows]
    known = dict(ImportMapping.objects.filter(workspace=workspace, active=True, source_key__in=keys)
                 .values_list("source_key", "item_id"))
    names = {name for r in batch.rows if r["key"] not in known for name in r["fields"].get("tags", [])}
    matches = defaultdict(list)
    for tag in Tag.objects.filter(workspace=workspace, parent=None, title__in=names):
        matches[tag.title].append(tag)
    return known, matches


def preview(workspace, batch):
    known, matches = bindings(workspace, batch)
    issues = list(batch.issues)
    rows = [{k: v for k, v in r.items() if k != "key"} | {"state": "existing" if r["key"] in known else "new"}
            for r in batch.rows]
    if batch.status == "staged":
        by_line = {r["line"]: r for r in batch.rows}
        active = Item.objects.filter(workspace=workspace, pk__in=known.values(), shelf="active").in_bulk()
        for r in batch.rows:
            if r["key"] in known:
                issues.append(issue(r["line"], "identity", "transformed", "Already imported; current item is preserved."))
                continue
            parent = by_line.get(r["parentLine"])
            if parent and parent["key"] in known:
                ref = active.get(known[parent["key"]])
                allowed = ("folder",) if r["kind"] in ("folder", "project") else ("project", "group")
                if not ref or ref.kind not in allowed:
                    issues.append(issue(r["line"], "parent", "invalid", "Previously imported parent is unavailable or incompatible."))
        for name, choices in matches.items():
            if len(choices) > 1 or choices[0].status == "dropped":
                issues.append(issue(0, "tags", "invalid", f"Root tag is ambiguous or dropped: {name}"))
    return {**summary(batch), "encoding": batch.encoding, "parserVersion": batch.parser_version,
            "expectedRevision": workspace.revision, "rows": rows, "issues": issues, "conflicts": batch.conflicts,
            "canCommit": batch.status == "staged" and not any(i["category"] == "invalid" for i in issues)}
