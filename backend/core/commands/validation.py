"""Validate the small, versioned M2 command vocabulary."""

from datetime import date
from uuid import UUID


class CommandError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def fields(value, required=(), optional=()):
    if not isinstance(value, dict):
        raise CommandError("A JSON object is required.")
    if not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise CommandError("Missing or unsupported command fields.")
    return value


def identifier(value):
    if not isinstance(value, str):
        raise CommandError("Expected a UUID.")
    try:
        return UUID(value)
    except ValueError as error:
        raise CommandError("Expected a UUID.") from error


def identifiers(values):
    if not isinstance(values, list) or not 1 <= len(values) <= 200:
        raise CommandError("Select between 1 and 200 items.")
    result = [identifier(value) for value in values]
    if len(set(result)) != len(result):
        raise CommandError("Duplicate items in this command.")
    return result


def title(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 200:
        raise CommandError("Enter a title of 1 to 200 characters.")
    if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise CommandError("Titles must contain printable text on one line.")
    return value.strip()


def due_date(value):
    if value is None:
        return None
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as error:
        raise CommandError("Enter a calendar date in YYYY-MM-DD format.") from error
    if value != parsed.isoformat():
        raise CommandError("Enter a calendar date in YYYY-MM-DD format.")
    return parsed
