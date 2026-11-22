"""Move selected subtree roots in manual order inside the workspace lock."""

from collections import defaultdict

from core.models import Item

from .edits import GAP
from .state import Changes, LIBRARY_KINDS, save_changed
from .validation import CommandError, fields, identifier, title


class Layout:
    def __init__(self, tree, selected):
        self.by_id = {}
        self.children = defaultdict(list)
        for item in tree.items.order_by("position", "id"):
            self.by_id[item.pk] = item
            self.children[item.parent_id].append(item)
        selected_ids = {item.pk for item in selected}
        # Descendants of a selected group travel with it, even in a flat view.
        roots = []
        stack = list(reversed(self.children[None]))
        while stack:
            item = stack.pop()
            if item.pk in selected_ids:
                roots.append(item)
            else:
                stack.extend(reversed(self.children[item.pk]))
        self.library = all(item.kind in LIBRARY_KINDS for item in roots)
        self.roots = roots
        self.moving = {item.pk for item in roots}
        self.result = Changes([str(item.pk) for item in selected])

    def siblings(self, parent_id):
        return [item for item in self.children[parent_id] if (item.kind in LIBRARY_KINDS) == self.library]

    def move(self, parent_id, anchor):
        if any((item.kind in LIBRARY_KINDS) != self.library for item in self.roots):
            raise CommandError("Choose items that can share a destination.")
        ancestor = self.by_id.get(parent_id)
        while ancestor:
            if ancestor.pk in self.moving:
                raise CommandError("A group cannot move inside its own subtree.")
            ancestor = self.by_id.get(ancestor.parent_id)
        remaining = [item for item in self.siblings(parent_id) if item.pk not in self.moving]
        slot = len(remaining)
        if anchor:
            if anchor.parent_id != parent_id or anchor.pk in self.moving or (anchor.kind in LIBRARY_KINDS) != self.library:
                raise CommandError("The insertion point is outside the selected destination.", 409)
            slot = remaining.index(anchor)
        ordered = remaining[:slot] + self.roots + remaining[slot:]
        for rank, item in enumerate(ordered, 1):
            placement = {"parent_id": parent_id, "position": rank * GAP}
            if item.pk in self.moving and item.parent_id != parent_id:
                placement["filing_project_id"] = None
            save_changed(item, self.result, **placement)
        return self.result


def organize(tree, name, data):
    if name in ("move", "reorder"):
        fields(data, ["ids", "parentId"], ["beforeId"])
    elif name == "group":
        fields(data, ["ids", "id", "title"])
    else:
        fields(data, ["ids"])
    layout = Layout(tree, tree.selected(data["ids"]))
    if any((item.kind in LIBRARY_KINDS) != layout.library for item in layout.roots):
        raise CommandError("Choose items that can share a destination.")
    if name in ("move", "reorder"):
        parent = tree.parent(data["parentId"], library=layout.library)
        parent_id = parent.pk if parent else None
        if name == "reorder" and any(item.parent_id != parent_id for item in layout.roots):
            raise CommandError("Reordering requires a single existing parent.")
        anchor = tree.get(identifier(data["beforeId"])) if "beforeId" in data else None
        return layout.move(parent_id, anchor)
    first = layout.roots[0]
    if any(item.parent_id != first.parent_id for item in layout.roots):
        raise CommandError("Select siblings for this command.")
    peers = layout.siblings(first.parent_id)
    if name == "group":
        if layout.library:
            raise CommandError("Group actions within a project or Inbox.")
        group = Item.objects.create(
            id=identifier(data["id"]), workspace=tree.workspace, kind="group",
            title=title(data["title"]), parent_id=first.parent_id, position=first.position,
        )
        layout.result.touch(group)
        layout.result.selection = [str(group.pk)]
        return layout.move(group.pk, None)
    if name == "indent":
        index = peers.index(first)
        if not index:
            raise CommandError("Indent requires a previous sibling.")
        previous = peers[index - 1]
        if layout.library and previous.kind != "folder":
            raise CommandError("Indent projects or folders beneath a folder.")
        if previous.kind == "action":
            save_changed(previous, layout.result, kind="group")
        return layout.move(previous.pk, None)
    parent = layout.by_id.get(first.parent_id)
    if not parent or parent.kind != ("folder" if layout.library else "group"):
        raise CommandError("These tasks are already at the top of the outline.")
    peers = layout.siblings(parent.parent_id)
    next_index = peers.index(parent) + 1
    anchor = peers[next_index] if next_index < len(peers) else None
    return layout.move(parent.parent_id, anchor)
