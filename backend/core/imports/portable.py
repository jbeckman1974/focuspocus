"""Version-one, owner-exportable import provenance. Live operation receipts never cross workspaces."""

import re
from uuid import UUID, uuid4

from core.models import Item, Tag

from .models import ImportBatch, ImportMapping
from .parser import ADAPTERS, PARSER_VERSION
from .source import MAX_ISSUES, MAX_ROWS, identity


def iter_export_batches(workspace):
    batches = ImportBatch.objects.filter(workspace=workspace, status__in=["committed", "rolled_back"]).prefetch_related("mappings")
    for batch in batches.defer("rows").order_by("created_at", "id").iterator(chunk_size=1):
        yield {"id": str(batch.pk), "format": batch.source_format, "sourceSha256": batch.source_hash,
                       "encoding": batch.encoding, "parserVersion": batch.parser_version, "status": batch.status,
                       "rowCount": batch.row_count, "issues": batch.issues, "guard": batch.guard,
                       "conflicts": batch.conflicts, "mappings": [
                           {"sourceId": m.source_id, "line": m.line, "itemId": str(m.item_id), "key": m.source_key}
                           for m in sorted(batch.mappings.all(), key=lambda m: m.line)]}


def export_batches(workspace):
    return list(iter_export_batches(workspace))


def shape(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or not set(required) <= set(value):
        raise ValueError("Malformed import batch record.")
    return value


def sequence(value, limit):
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError("Invalid import record list.")
    return value


def number(value, maximum, minimum=0):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Invalid import record number.")
    return value


def string(value, limit):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value or any(0xd800 <= ord(c) <= 0xdfff for c in value):
        raise ValueError("Invalid import record text.")
    return value


def uuid_string(value):
    if not isinstance(value, str):
        raise ValueError("Invalid import UUID.")
    return str(UUID(value))


class IdMap:
    def __init__(self, workspace, source_map, model):
        self.known = {str(k): str(v) for k, v in source_map.items()}
        if set(self.known.values()) != {
            str(v) for v in model.objects.filter(workspace=workspace, pk__in=self.known.values()).values_list("pk", flat=True)
        }:
            raise ValueError("Import provenance refers to a different workspace.")
        self.orphans = {}

    def __call__(self, value):
        key = uuid_string(value)
        if key in self.known:
            return self.known[key]
        # Missing records from history keep a consistently unmapped, fresh identity.
        if key not in self.orphans:
            self.orphans[key] = str(uuid4())
        return self.orphans[key]


def guard_rows(data, items, tags):
    shape(data, ["items", "tags", "groups"])
    result = {}
    for name, keymap in (("items", items), ("tags", tags)):
        values = data[name]
        if not isinstance(values, dict) or len(values) > MAX_ROWS * 64:
            raise ValueError("Malformed rollback versions.")
        result[name] = {keymap(key): number(v, 2**63-1, 1) for key, v in values.items()}
    groups = []
    seen = set()
    for group in sequence(data["groups"], MAX_ROWS):
        shape(group, ["parent", "ids", "library"])
        parent = None if group["parent"] is None else items(group["parent"])
        family = group["library"]
        if type(family) is not bool or (parent, family) in seen:
            raise ValueError("Invalid import sibling group.")
        seen.add((parent, family))
        ids = [items(pk) for pk in sequence(group["ids"], 1_000_000)]
        if len(set(ids)) != len(ids):
            raise ValueError("Repeated sibling ID.")
        groups.append({"parent": parent, "library": family, "ids": ids})
    result["groups"] = sorted(groups, key=lambda g: str((UUID(g["parent"]) if g["parent"] else None, g["library"])))
    return result


def restore_batches(workspace, rows, item_ids, tag_ids):
    """Call inside the same transaction that creates the destination content."""
    items, tags = IdMap(workspace, item_ids, Item), IdMap(workspace, tag_ids, Tag)
    restored, active_sources, active_files = {}, set(), set()
    for row in sequence(rows, 10000):
        shape(row, ["id", "format", "sourceSha256", "encoding", "parserVersion", "status", "rowCount",
                    "issues", "conflicts", "guard", "mappings"])
        key, fmt, digest = uuid_string(row["id"]), string(row["format"], 12), string(row["sourceSha256"], 64)
        status, encoding = string(row["status"], 16), string(row["encoding"], 16)
        if (key in restored or fmt not in ADAPTERS or not re.fullmatch(r"[a-f0-9]{64}", digest)
                or encoding not in ("utf-8", "utf-8-sig", "utf-16") or status not in ("committed", "rolled_back")
                or number(row["parserVersion"], PARSER_VERSION, 1) != PARSER_VERSION):
            raise ValueError("Unsupported or overlapping import provenance.")
        count = number(row["rowCount"], MAX_ROWS)
        issues = sequence(row["issues"], MAX_ISSUES + 32)
        for entry in issues:
            shape(entry, ["line", "field", "category", "message"])
            number(entry["line"], 2**31-1)
            string(entry["field"], 512 * 1024)
            string(entry["message"], 512 * 1024)
            if entry["category"] not in ("ambiguous", "invalid", "transformed", "unsupported", "omitted by source"):
                raise ValueError("Invalid import diagnostic.")
        conflicts = []
        for conflict in sequence(row["conflicts"], MAX_ROWS * 65 + 16):
            shape(conflict, ["reason"], ["tagId", "itemId"])
            mapped = {"reason": string(conflict["reason"], 256)}
            for field, remap in (("itemId", items), ("tagId", tags)):
                if field in conflict:
                    mapped[field] = remap(conflict[field])
            conflicts.append(mapped)
        guard = guard_rows(row["guard"], items, tags)
        live = status == "committed"
        if live and (fmt, digest) in active_files:
            raise ValueError("Repeated active source file.")
        if live:
            active_files.add((fmt, digest))
        batch = ImportBatch.objects.create(workspace=workspace, source_hash=digest, source_format=fmt, status=status,
                                          parser_version=PARSER_VERSION, encoding=encoding, row_count=count,
                                          issues=issues, conflicts=conflicts, guard=guard)
        mappings, batch_keys = [], set()
        for entry in sequence(row["mappings"], count):
            shape(entry, ["sourceId", "line", "itemId", "key"])
            external = string(entry["sourceId"], 500)
            line = number(entry["line"], 2**31-1, 1)
            key_id = identity(fmt, digest, line, external)
            if entry["key"] != key_id or key_id in batch_keys or live and key_id in active_sources:
                raise ValueError("Invalid or duplicate source mapping.")
            batch_keys.add(key_id)
            if live:
                active_sources.add(key_id)
            mappings.append(ImportMapping(workspace=workspace, batch=batch, source_key=key_id, source_id=external,
                                          line=line, item_id=items(entry["itemId"]), active=live))
        if set(guard["items"]) != {m.item_id for m in mappings} or len(guard["items"]) != len(mappings):
            raise ValueError("Rollback items differ from the source mappings.")
        ImportMapping.objects.bulk_create(mappings)
        restored[key] = batch.pk
    return restored
