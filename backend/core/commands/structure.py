"""Move selected subtree roots in manual order inside the workspace lock."""

from collections import defaultdict

from core.models import Item

from .edits import GAP
from .state import Changes, save_changed
from .validation import CommandError, fields, identifier, title


class Layout:
    def __init__(self, tree, selected):
        self.by_id = {}
        self.children = defaultdict(list)
        for item in tree.items.order_by("position", "id"):
            self.by_id[item.pk] = item
            self.children[item.parent_id].append(item)
        selected_ids = {item.pk for item in selected}
        if any(item.kind == "project" for item in selected):
            raise CommandError("Choose actions or groups to organize.")
        # Descendants of a selected group travel with it, even in a flat view.
        roots = []
        stack = list(reversed(self.children[None]))
        while stack:
            item = stack.pop()
            if item.pk in selected_ids:
                roots.append(item)
            else:
                stack.extend(reversed(self.children[item.pk]))
        self.roots = roots
        self.moving = {item.pk for item in roots}
        self.result = Changes([str(item.pk) for item in selected])

    def siblings(self, parent_id):
        return [item for item in self.children[parent_id] if item.kind != "project"]

    def move(self, parent_id, anchor):
        ancestor = self.by_id.get(parent_id)
        while ancestor:
            if ancestor.pk in self.moving:
                raise CommandError("A group cannot move inside its own subtree.")
            ancestor = self.by_id.get(ancestor.parent_id)
        remaining = [item for item in self.siblings(parent_id) if item.pk not in self.moving]
        slot = len(remaining)
        if anchor:
            if anchor.parent_id != parent_id or anchor.pk in self.moving or anchor.kind == "project":
                raise CommandError("The insertion point is outside the selected destination.", 409)
            slot = remaining.index(anchor)
        ordered = remaining[:slot] + self.roots + remaining[slot:]
        for rank, item in enumerate(ordered, 1):
            save_changed(item, self.result, parent_id=parent_id, position=rank * GAP)
        return self.result


def organize(tree, name, data):
    if name in ("move", "reorder"):
        fields(data, ["ids", "parentId"], ["beforeId"])
    elif name == "group":
        fields(data, ["ids", "id", "title"])
    else:
        fields(data, ["ids"])
    layout = Layout(tree, tree.selected(data["ids"]))
    if name in ("move", "reorder"):
        parent = tree.parent(data["parentId"])
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
        if previous.kind == "action":
            save_changed(previous, layout.result, kind="group")
        return layout.move(previous.pk, None)
    parent = layout.by_id.get(first.parent_id)
    if not parent or parent.kind != "group":
        raise CommandError("These tasks are already at the top of the outline.")
    peers = layout.siblings(parent.parent_id)
    next_index = peers.index(parent) + 1
    anchor = peers[next_index] if next_index < len(peers) else None
    return layout.move(parent.parent_id, anchor)
