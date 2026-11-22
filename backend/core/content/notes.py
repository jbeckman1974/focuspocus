"""Validate the portable rich-text document and derive its searchable text."""

from urllib.parse import urlsplit

from core.commands.validation import CommandError, fields


EMPTY_NOTE = {"paragraphs": []}
MAX_CHARACTERS = 64 * 1024


def safe_text(value):
    if not isinstance(value, str) or any(
        (ord(char) < 32 and char != "\t") or 0xD800 <= ord(char) <= 0xDFFF for char in value
    ):
        raise CommandError("Note text must contain valid characters without embedded line breaks.")
    return value


def safe_link(value):
    if not isinstance(value, str) or len(value) > 2048 or any(char.isspace() or ord(char) < 32 for char in value):
        raise CommandError("Use an absolute HTTP or HTTPS link.")
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError as error:
        raise CommandError("Invalid link address.") from error
    if (parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or "\\" in value or any(0xD800 <= ord(c) <= 0xDFFF for c in value)):
        raise CommandError("Use an absolute HTTP or HTTPS link without credentials.")
    return value


def validate_document(document):
    fields(document, ["paragraphs"])
    paragraphs = document["paragraphs"]
    if not isinstance(paragraphs, list) or len(paragraphs) > 1024:
        raise CommandError("Too many note paragraphs.")
    result, plain = [], []
    size, runs = 0, 0
    for paragraph in paragraphs:
        if not isinstance(paragraph, list):
            raise CommandError("Invalid note paragraph.")
        runs += len(paragraph)
        if runs > 4096:
            raise CommandError("Too many text runs.")
        parts = []
        for run in paragraph:
            fields(run, ["text"], ["bold", "italic", "link"])
            part = {"text": safe_text(run["text"])}
            for mark in ("bold", "italic"):
                if mark in run:
                    if type(run[mark]) is not bool:
                        raise CommandError("Invalid text style.")
                    if run[mark]:
                        part[mark] = True
            if "link" in run:
                part["link"] = safe_link(run["link"])
            size += len(part["text"]) + len(part.get("link", ""))
            if size > MAX_CHARACTERS:
                raise CommandError("Note exceeds its character limit.", 413)
            if part["text"]:
                parts.append(part)
        result.append(parts)
        plain.append("".join(part["text"] for part in parts))
    return {"paragraphs": result}, "\n".join(plain)
