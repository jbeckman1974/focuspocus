"""Apply explicit Focus, a saved or ad hoc perspective and a bounded search to shared records."""

from core.commands.validation import CommandError, fields, identifier
from core.content.search import note_matches
from core.queries.outline import tree_order
from core.queries.records import read_records
from core.scheduling.dates import calendar_zone

from .definition import DEFAULT, check_references, choice, id_list, validate_definition
from .evaluate import Evaluation
from .focus import descendants
from .presentation import grouping, ordered, visible_rows
from .service import personal_state


def number(value, maximum, minimum=0):
    if type(value) is not int or not minimum <= value <= maximum:
        raise CommandError("Invalid query page.")
    return value


def query(user, workspace, body):
    fields(body, optional=["perspectiveId", "definition", "text", "scope", "hereIds", "viewZone", "offset", "limit"])
    if "perspectiveId" in body and "definition" in body:
        raise CommandError("Choose a saved perspective or a preview.")
    text = body.get("text", "")
    if not isinstance(text, str) or len(text) > 500:
        raise CommandError("Search text is limited to 500 characters.")
    if "\x00" in text or any(0xD800 <= ord(char) <= 0xDFFF for char in text):
        raise CommandError("Search text contains an unsupported character.")
    needle = text.strip().casefold()
    scope = choice(body.get("scope", "here"), ("here", "remaining", "everything"), "search scope")
    selected = set(id_list(body["hereIds"], 5000)) if "hereIds" in body else None
    start = number(body.get("offset", 0), 10_000_000)
    limit = number(body.get("limit", 200), 500, minimum=1)
    state = personal_state(user, workspace)
    try:
        zone = calendar_zone(body["viewZone"]) if "viewZone" in body else None
    except (TypeError, ValueError) as error:
        raise CommandError("Invalid view timezone.") from error
    rows, tags, metadata = read_records(workspace, zone)
    definition = DEFAULT
    if "perspectiveId" in body:
        key = identifier(body["perspectiveId"])
        record = state.perspectives.filter(view_id=key).first() if state else None
        if not record:
            raise CommandError("Perspective unavailable.", 404)
        definition = record.definition
    elif "definition" in body:
        definition, refs = validate_definition(body["definition"])
        check_references(refs, rows, tags)

    focus = state.focus_ids if state else []
    allowed = descendants(rows, focus) if focus else None
    if definition["scopeIds"] and scope == "here":
        saved_scope = descendants(rows, definition["scopeIds"])
        allowed = saved_scope if allowed is None else allowed & saved_scope
    order = list(tree_order(rows, None))
    candidates = [row for row, _, _, _ in order if allowed is None or row["id"] in allowed]
    if selected is not None and scope == "here":
        candidates = [row for row in candidates if row["id"] in selected]
    terms = set(text_terms(definition["expression"])) if scope == "here" else set()
    if needle:
        terms.add(needle)
    hits = note_matches(workspace, [row["id"] for row in candidates], terms)
    evaluation = Evaluation(rows, tags, order, hits, metadata["viewZone"])
    matches = candidates
    if scope == "here":
        predicate = evaluation.predicate(definition["expression"])
        matches = [row for row in matches if predicate(row)]
    elif scope == "remaining":
        matches = [row for row in matches if row["effective"]["remaining"]]
    if needle:
        matches = [row for row in matches if evaluation.includes_text(row, needle)]
    sequence = ordered(matches, definition)
    page = sequence[start:start + limit]
    return {"workspaceId": str(workspace.pk), "revision": workspace.revision,
            "personalVersion": state.version if state else 0, "focusIds": focus,
            "matchIds": [row["id"] for row in page], "rows": visible_rows(page, evaluation.items, definition["presentation"]),
            "groups": grouping(page, definition["groupBy"], evaluation), "count": len(matches),
            "actionCount": sum(row["kind"] == "action" for row in matches),
            "offset": start, "nextOffset": start + len(page) if start + len(page) < len(matches) else None, **metadata}


def text_terms(node):
    if "field" in node:
        if node["field"] == "text":
            yield node["value"].casefold()
    else:
        for child in next(iter(node.values())):
            yield from text_terms(child)
