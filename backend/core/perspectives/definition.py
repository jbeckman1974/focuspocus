"""Validate versioned perspective expressions and allowlisted presentation options."""

from datetime import date

from core.commands.validation import CommandError, fields, identifier, title


AVAILABILITY = ("remaining", "available", "first-available", "blocked")
KINDS = ("action", "group", "project", "folder")
STATUSES = ("active", "held", "completed", "dropped")
GROUPS = ("none", "project", "tag", "status", "due")
SORTS = ("manual", "title", "due", "planned", "defer", "changed", "duration")
ICONS = ("list", "star", "flag", "folder", "calendar", "tag", "check", "clock", "search", "layers")
DEFAULT = {"version": 1, "expression": {"all": []}, "scopeIds": [], "groupBy": "none",
           "sortBy": "manual", "direction": "asc", "presentation": "list"}


def choice(value, values, label):
    if not isinstance(value, str) or value not in values:
        raise CommandError(f"Unsupported {label}.")
    return value


def id_list(values, limit=200):
    if not isinstance(values, list) or len(values) > limit:
        raise CommandError("Invalid number of selected items.")
    parsed = [str(identifier(value)) for value in values]
    if len(set(parsed)) != len(parsed):
        raise CommandError("Select each item once.")
    return parsed


def day(value):
    if isinstance(value, str):
        try:
            if date.fromisoformat(value).isoformat() == value:
                return value
        except ValueError:
            pass
    raise CommandError("Use a calendar date in YYYY-MM-DD format.")


def duration(value):
    if type(value) is not int or not 0 <= value <= 5_256_000:
        raise CommandError("Expected a duration in whole minutes.")
    return value


def bounds(value, low, high, convert):
    fields(value, optional=[low, high])
    if not value:
        raise CommandError("Provide at least one bound.")
    parsed = {key: convert(raw) for key, raw in value.items()}
    if low in parsed and high in parsed and parsed[low] > parsed[high]:
        raise CommandError("The range starts after its end.")
    return parsed


def leaf(field, value, references):
    if field in ("tag", "contains"):
        key = str(identifier(value))
        references[field].add(key)
        return key
    if field in ("flagged", "inbox", "singleAction", "repeating"):
        if type(value) is not bool:
            raise CommandError("Expected a true or false predicate.")
        return value
    if field in ("defer", "planned", "due"):
        return value if type(value) is bool else bounds(value, "from", "through", day)
    if field == "duration":
        return bounds(value, "min", "max", duration)
    if field == "text":
        return title(value)
    choices = {"availability": AVAILABILITY, "kind": KINDS, "status": STATUSES}
    if field in choices:
        return choice(value, choices[field], field)
    raise CommandError("Unsupported perspective predicate.")


def validate_definition(raw):
    fields(raw, ["version", "expression"], ["scopeIds", "groupBy", "sortBy", "direction", "presentation"])
    if type(raw["version"]) is not int or raw["version"] != 1:
        raise CommandError("Unsupported perspective version.")
    scope = id_list(raw.get("scopeIds", []))
    refs = {"scope": set(scope), "tag": set(), "contains": set()}
    count = 0

    def node(value, depth=0):
        nonlocal count
        count += 1
        if depth > 8 or count > 100:
            raise CommandError("Perspective rules exceed the supported size.")
        if isinstance(value, dict) and len(value) == 1:
            operator, children = next(iter(value.items()))
            if operator in ("all", "any", "none") and isinstance(children, list):
                return {operator: [node(child, depth + 1) for child in children]}
        fields(value, ["field", "value"])
        field = value["field"]
        if not isinstance(field, str):
            raise CommandError("Expected a named predicate.")
        return {"field": field, "value": leaf(field, value["value"], refs)}

    result = {"version": 1, "expression": node(raw["expression"]), "scopeIds": scope}
    for field, allowed in (("groupBy", GROUPS), ("sortBy", SORTS), ("direction", ("asc", "desc")),
                           ("presentation", ("list", "outline"))):
        result[field] = choice(raw.get(field, DEFAULT[field]), allowed, field)
    return result, refs


def check_references(refs, items, tags):
    by_kind = {row["id"]: row["kind"] for row in items}
    if (any(by_kind.get(key) not in ("folder", "project") for key in refs["scope"])
            or any(by_kind.get(key) not in ("folder", "project", "group") for key in refs["contains"])
            or not refs["tag"].issubset({row["id"] for row in tags})):
        raise CommandError("A referenced item is unavailable.", 404)
