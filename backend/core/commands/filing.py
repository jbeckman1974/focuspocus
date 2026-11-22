"""File eligible Inbox roots while keeping capture identities and order."""

from uuid import uuid4

from core.models import Item
from core.planning.schedules import initialize_projects

from .edits import GAP, next_position
from .state import Changes, save_changed
from .validation import CommandError, fields, identifier


POLICIES = ("project", "tag", "both", "either")


def set_policy(tree, data):
    fields(data, ["policy"])
    policy = data["policy"]
    if policy not in POLICIES:
        raise CommandError("Choose a valid Inbox filing rule.")
    result = Changes([])
    if tree.workspace.filing_policy != policy:
        tree.workspace.filing_policy = policy
        tree.workspace.save(update_fields=["filing_policy"])
        result.versions[str(tree.workspace.pk)] = tree.workspace.revision + 1
    return result


def assign(tree, data):
    fields(data, ["ids", "projectId"])
    target = None if data["projectId"] is None else tree.get(identifier(data["projectId"]))
    if target and target.kind != "project":
        raise CommandError("The filing destination must be a project.")
    items = tree.selected(data["ids"])
    if any(item.parent_id is not None or item.kind not in ("action", "group") for item in items):
        raise CommandError("Choose only top-level Inbox items.")
    result = Changes([str(item.pk) for item in items])
    for item in items:
        save_changed(item, result, filing_project_id=target.pk if target else None)
    return result


def miscellaneous(tree, result):
    project = tree.items.filter(is_miscellaneous=True).first()
    if project:
        return project
    project = Item.objects.create(id=uuid4(), workspace=tree.workspace, kind="project",
                                  title="Miscellaneous", mode="single-action", is_miscellaneous=True,
                                  position=next_position(tree.siblings(None, library=True)))
    initialize_projects(tree.workspace, [project])
    result.touch(project)
    return project


def eligible(policy, tagged, designated):
    if policy == "project":
        return designated
    if policy == "tag":
        return tagged
    if policy == "both":
        return tagged and designated
    return tagged or designated


def file_inbox(tree, data):
    fields(data)
    inbox = tree.siblings(None).prefetch_related("tags")
    policy = tree.workspace.filing_policy
    targets = tree.items.filter(kind="project").in_bulk()
    last_positions = {}
    result = Changes([])
    for item in inbox:
        designated = item.filing_project_id is not None
        if not eligible(policy, bool(item.tags.all()), designated):
            continue
        if designated and item.filing_project_id not in targets:
            raise CommandError("A filing project is unavailable. Choose a new project.", 409)
        target = targets[item.filing_project_id] if designated else miscellaneous(tree, result)
        if target.pk not in last_positions:
            last_positions[target.pk] = next_position(tree.siblings(target.pk))
        save_changed(item, result, parent_id=target.pk, position=last_positions[target.pk], filing_project_id=None)
        last_positions[target.pk] += GAP
        result.selection.append(str(item.pk))
    return result
