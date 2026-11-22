"""Bounded source decoding and per-row comparison shared by both text adapters."""

import hashlib

from core.commands.validation import CommandError


MAX_BYTES = 512 * 1024
MAX_ROWS = 2000
MAX_ISSUES = 5000


def source_text(raw):
    if not raw or len(raw) > MAX_BYTES:
        raise CommandError("Supply a nonempty file of at most 512 KiB.", 413)
    encoding = "utf-8"
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        encoding = "utf-16"
    elif raw.startswith(b"\xef\xbb\xbf"):
        encoding = "utf-8-sig"
    try:
        text = raw.decode(encoding)
    except UnicodeError as error:
        raise CommandError("Unable to decode source. Use UTF-8 or UTF-16 with a byte order mark.") from error
    if any(ord(ch) < 32 and ch not in "\t\r\n" for ch in text):
        raise CommandError("The source contains an unsupported control character.")
    return text.replace("\r\n", "\n").replace("\r", "\n"), encoding


def issue(line, field, category, message):
    return {"line": line, "field": field, "category": category, "message": message}


def identity(source_format, digest, line, external):
    material = ("id:" + external if external else f"file:{digest}:row:{line}").encode()
    return source_format + ":" + hashlib.sha256(material).hexdigest()


def row(line, name, kind, parent=None, source_id=""):
    return {"line": line, "title": name, "kind": kind, "parentLine": parent, "sourceId": source_id,
            "fields": {}, "notes": []}
