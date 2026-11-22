"""Project the same evaluated records into user-facing outline perspectives."""

from collections import defaultdict

from core.commands.validation import CommandError, identifier


VIEWS = {"all", "inbox", "projects", "tags", "flagged", "completed", "changed"}
FILTERS = {"everything": None, "remaining": "remaining", "available": "available",
           "first-available": "firstAvailable", "blocked": "blocked"}


def tree_order(rows, selected_folder):
    """Yield preorder, root, and containing project without a recursion depth limit."""
    children = defaultdict(list)
    for row in rows:
        children[row["parentId"]].append(row)
    stack = [(row, root, None, False) for root in ("inbox", "root") for row in reversed(children[root])]
    while stack:
        row, root, project, in_folder = stack.pop()
        in_folder = in_folder or row["id"] == selected_folder
        if row["kind"] == "project":
            project = row["id"]
        yield row, root, project, in_folder
        stack.extend((child, root, project, in_folder) for child in reversed(children[row["id"]]))


def tag_scope(tags, selected):
    if selected is None:
        return {tag["id"] for tag in tags}
    if not any(tag["id"] == selected for tag in tags):
        raise CommandError("Tag unavailable.", 404)
    children = defaultdict(list)
    for tag in tags:
        children[tag["parentId"]].append(tag["id"])
    branch, stack = set(), [selected]
    while stack:
        tag = stack.pop()
        if tag not in branch:
            branch.add(tag)
            stack.extend(children[tag])
    return branch


def in_view(row, view, root, project, selected_project, selected_tags):
    if view == "inbox":
        return root == "inbox"
    if view == "projects":
        return root == "root" and (not selected_project or project == selected_project)
    if view == "tags":
        return not selected_tags.isdisjoint(row["tags"])
    if view == "flagged":
        return row["effective"]["flagged"]
    if view == "completed":
        return row["status"] == "completed"
    return True


def with_context(matches, order, by_id):
    visible = set(matches)
    for item_id in matches:
        parent = by_id[item_id]["parentId"]
        while parent in by_id and parent not in visible:
            visible.add(parent)
            parent = by_id[parent]["parentId"]
    return [row["id"] for row, _, _, _ in order if row["id"] in visible]


def options(params):
    if set(params) - {"view", "availability", "projectId", "folderId", "tagId", "viewZone"}:
        raise CommandError("Unsupported outline option.", 400)
    if any(len(params.getlist(name)) != 1 for name in params):
        raise CommandError("Each outline option may appear once.", 400)
    view = params.get("view", "all")
    availability = params.get("availability", "everything")
    if view not in VIEWS or availability not in FILTERS:
        raise CommandError("Unsupported view or availability filter.", 400)
    if (("projectId" in params or "folderId" in params) and view != "projects") or ("tagId" in params and view != "tags"):
        raise CommandError("The selected scope does not belong to this view.", 400)
    if "folderId" in params and "projectId" in params:
        raise CommandError("Choose one project or folder scope.", 400)
    folder = str(identifier(params["folderId"])) if "folderId" in params else None
    project = str(identifier(params["projectId"])) if "projectId" in params else None
    tag = str(identifier(params["tagId"])) if "tagId" in params else None
    return view, availability, project, tag, folder


def project_outline(rows, tags, *, view, availability, project_id=None, tag_id=None, folder_id=None):
    by_id = {row["id"]: row for row in rows}
    if project_id is not None and by_id.get(project_id, {}).get("kind") != "project":
        raise CommandError("Project unavailable.", 404)
    if folder_id is not None and by_id.get(folder_id, {}).get("kind") != "folder":
        raise CommandError("Folder unavailable.", 404)
    selected_tags = tag_scope(tags, tag_id) if view == "tags" else set()
    order = list(tree_order(rows, folder_id))
    key = FILTERS[availability]
    matches = []
    for row, root, project, in_folder in order:
        if folder_id and not in_folder:
            continue
        if not in_view(row, view, root, project, project_id, selected_tags):
            continue
        if key and not row["effective"][key]:
            continue
        if key and view in ("inbox", "all", "projects") and row["kind"] != "action":
            continue
        matches.append(row["id"])
    if view in ("completed", "changed"):
        timestamp = "completedAt" if view == "completed" else "changedAt"
        matches.sort(key=lambda item_id: by_id[item_id][timestamp] or "", reverse=True)
        visible = matches
    else:
        visible = with_context(matches, order, by_id)
    matched = set(matches)
    return {
        "view": view, "availability": availability, "matchIds": matches,
        "rows": [{**by_id[item_id], "context": item_id not in matched} for item_id in visible],
        "count": len(matches), "actionCount": sum(by_id[item_id]["kind"] == "action" for item_id in matches),
    }
