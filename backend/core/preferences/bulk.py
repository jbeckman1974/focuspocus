"""Compose a mixed inspector submission inside the command's existing atomic journal."""

from core.commands import edits, properties, schedules, tagging
from core.commands.state import Changes
from core.commands.validation import CommandError, fields, identifiers


def apply_bulk(tree, user, data):
    fields(data, ["ids", "changes"])
    ids, patch = data["ids"], data["changes"]
    fields(patch, optional=["title", "flagged", "status", "schedule", "durationMinutes", "tags"])
    if not patch:
        raise CommandError("Choose at least one field to change.")
    result = Changes([str(item.pk) for item in tree.selected(ids)])

    def collect(change):
        result.versions.update(change.versions)

    if "title" in patch:
        collect(edits.edit(tree, {"ids": ids, "title": patch["title"]}))
    schedule = {key: patch[key] for key in ("schedule", "durationMinutes") if key in patch}
    if schedule:
        collect(schedules.set_schedule(tree, {"ids": ids, **schedule}, user=user))
    if "tags" in patch:
        tags = patch["tags"]
        if not isinstance(tags, list) or not 1 <= len(tags) <= 100:
            raise CommandError("Choose 1 to 100 tag changes.")
        for tag in tags:
            fields(tag, ["tagId", "enabled"])
        identifiers([tag["tagId"] for tag in tags])
        for tag in tags:
            collect(tagging.set_tags(tree, {"ids": ids, **tag}))
    # Completion can generate a successor. It must see the final title, dates, tags and flag.
    values = {key: patch[key] for key in ("flagged", "status") if key in patch}
    if values:
        collect(properties.set_properties(tree, {"ids": ids, **values}))
    return result
