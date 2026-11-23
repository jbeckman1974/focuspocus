"""Bounded stored ZIP. Member names are fixed or content hashes and never become filesystem paths."""
import hashlib
import json
from datetime import date
from struct import unpack
from tempfile import TemporaryFile
from zipfile import ZIP_STORED, ZipFile
from uuid import UUID


FORMAT = "focuspocus-workspace"
VERSION = 2
MAX_RECORD_BYTES = 64 * 1024 * 1024
MAX_INDEX_BYTES = 4 * 1024 * 1024
MAX_FILES = 12000


def limit():
    from django.conf import settings
    return settings.WORKSPACE_ATTACHMENT_MAX_BYTES + MAX_RECORD_BYTES + 2 * MAX_INDEX_BYTES


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    def wire(item):
        if isinstance(item, date):
            return item.isoformat()
        if isinstance(item, UUID):
            return str(item)
        raise TypeError("Unsupported portable value.")
    return json.dumps(value, default=wire, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def counts(records):
    return {name: len(rows) for name, rows in records.items() if isinstance(rows, list)}


def write_bundle(workspace, records, bodies):
    contents = encoded(records)
    if len(contents) > MAX_RECORD_BYTES:
        raise ValueError("Workspace record data exceeds the bundle limit.")
    manifest = {"format": FORMAT, "version": VERSION, "workspaceId": str(workspace.pk), "revision": workspace.revision,
                "counts": counts(records), "recordBytes": len(contents), "recordSha256": digest(contents)}
    file = TemporaryFile()
    try:
        with ZipFile(file, "w", ZIP_STORED, allowZip64=False) as archive:
            archive.writestr("manifest.json", encoded(manifest))
            archive.writestr("records.json", contents)
            for index, (name, size, raw) in enumerate(bodies, 1):
                if index > MAX_FILES or file.tell() + size > limit() or len(raw) != size or digest(raw) != name:
                    raise ValueError("Workspace files exceed the supported size or fail their checksum.")
                archive.writestr(f"files/{name}", bytes(raw))
        if file.tell() > limit():
            raise ValueError("Workspace exceeds the bundle size limit.")
        file.seek(0)
        return file
    except BaseException:
        file.close()
        raise


def _object(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("Duplicate JSON field.")
    return result


def _json(raw):
    def reject_constant(_):
        raise ValueError("Invalid JSON number.")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_object, parse_constant=reject_constant)
    except (RecursionError, UnicodeError, ValueError) as error:
        raise ValueError("Invalid bundle JSON.") from error


def open_bundle(file):
    # Check the central directory before zipfile allocates one object per entry.
    size = file.seek(0, 2)
    if not 22 <= size <= limit():
        raise ValueError("Invalid bundle length.")
    file.seek(-22, 2)
    mark, disk, start, on_disk, total, length, offset, comment = unpack("<4s4H2LH", file.read(22))
    if (mark != b"PK\x05\x06" or disk or start or comment or total != on_disk or not 2 <= total <= MAX_FILES + 2
            or length > MAX_INDEX_BYTES or offset + length != size - 22):
        raise ValueError("Unsupported ZIP directory.")
    archive = ZipFile(file, "r")
    try:
        members = archive.infolist()
        if (len(members) != total or len(set(archive.namelist())) != total
                or any(entry.compress_type != ZIP_STORED or entry.flag_bits & 1 or entry.file_size != entry.compress_size
                       or entry.file_size < 0 for entry in members)):
            raise ValueError("Unsupported ZIP members.")
        if (archive.getinfo("manifest.json").file_size > 16384 or
                archive.getinfo("records.json").file_size > MAX_RECORD_BYTES):
            raise ValueError("Oversized bundle metadata.")
        manifest = _json(archive.read("manifest.json"))
        if (not isinstance(manifest, dict) or manifest.get("format") != FORMAT or type(manifest.get("version")) is not int
                or manifest["version"] not in (1, VERSION) or type(manifest.get("revision")) is not int or manifest["revision"] < 0):
            raise ValueError("Unsupported workspace bundle version or revision.")
        UUID(manifest["workspaceId"])
        raw = archive.read("records.json")
        if manifest["recordBytes"] != len(raw) or manifest["recordSha256"] != digest(raw):
            raise ValueError("Invalid record checksum.")
        records = _json(raw)
        if not isinstance(records, dict) or manifest["counts"] != counts(records):
            raise ValueError("Invalid record counts.")
        if manifest["version"] == 1:
            if not isinstance(records.get("items"), list):
                raise ValueError("Invalid version-one item records.")
            for item in records["items"]:
                if not isinstance(item, dict) or "in_progress" in item:
                    raise ValueError("Invalid version-one item fields.")
                item["in_progress"] = False
        return archive, records
    except BaseException:
        archive.close()
        raise
