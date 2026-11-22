"""Direct tag assignments and exclusive choices in a workspace's tag tree."""

from collections import defaultdict

from django.utils import timezone

from core.models import ItemTag, Tag

from .state import Changes, save_changed
from .validation import CommandError, fields, identifier, identifiers, title


class TagTree:
    def __init__(self, tree):
        self.workspace = tree.workspace
        self.tags = tree.tags.in_bulk()

    def get(self, raw):
        tag = self.tags.get(identifier(raw))
        if tag is None:
            raise CommandError("Tag unavailable.", 404)
        return tag

    def branch(self, tag):
        seen = set()
        while tag:
            if tag.pk in seen:
                raise CommandError("A tag cannot be its own ancestor.")
            seen.add(tag.pk)
            yield tag
            tag = self.tags.get(tag.parent_id)

    def exclusive_groups(self, tag):
        return {ancestor.pk for ancestor in self.branch(tag) if ancestor.exclusive}

    def validate_assignments(self, tags, *, allow_dropped=False):
        groups = set()
        for tag in tags:
            branch = tuple(self.branch(tag))
            if not allow_dropped and any(parent.status == "dropped" for parent in branch):
                raise CommandError("Choose an active or held tag.")
            current = {parent.pk for parent in branch if parent.exclusive}
            if groups & current:
                raise CommandError("Choose one tag from each exclusive group.", 409)
            groups.update(current)

    def check_existing(self):
        grouped = defaultdict(list)
        for item_id, tag_id in ItemTag.objects.filter(workspace=self.workspace).values_list("item_id", "tag_id"):
            grouped[item_id].append(self.tags[tag_id])
        for tags in grouped.values():
            self.validate_assignments(tags, allow_dropped=True)


def tag_properties(tags, data):
    values = {}
    if "parentId" in data:
        values["parent_id"] = None if data["parentId"] is None else tags.get(data["parentId"]).pk
    if "exclusive" in data:
        if type(data["exclusive"]) is not bool:
            raise CommandError("Choose whether this group is exclusive.")
        values["exclusive"] = data["exclusive"]
    if "status" in data:
        if data["status"] not in ("active", "held", "dropped"):
            raise CommandError("Choose a valid tag status.")
        values["status"] = data["status"]
    if "title" in data:
        values["title"] = title(data["title"])
    return values


def create_tag(tree, data):
    fields(data, ["id", "title"], ["parentId", "exclusive", "status"])
    tags = TagTree(tree)
    tag = Tag.objects.create(id=identifier(data["id"]), workspace=tree.workspace, **tag_properties(tags, data))
    changes = Changes([str(tag.pk)])
    changes.touch(tag)
    return changes


def edit_tag(tree, data):
    fields(data, ["id"], ["parentId", "title", "status", "exclusive"])
    tags = TagTree(tree)
    tag = tags.get(data["id"])
    values = tag_properties(tags, data)
    if not values:
        raise CommandError("Choose a tag property to edit.")
    result = Changes([str(tag.pk)])
    # Validate hierarchy before the FK write. The command transaction protects existing assignments.
    parent_id = values.get("parent_id", tag.parent_id)
    if parent_id and tag.pk in {p.pk for p in tags.branch(tags.tags[parent_id])}:
        raise CommandError("A tag cannot move inside its own branch.")
    save_changed(tag, result, **values)
    if "parent_id" in values or values.get("exclusive"):
        tags.check_existing()
    return result


def insertion_tags(tag_tree, row, inherited):
    explicit = row.get("tagIds", [])
    if explicit == []:
        # Retain historical dropped assignments on existing items. New items may only
        # receive eligible choices, even if their parent's tag has since been dropped.
        return [tag for tag in inherited if all(p.status != "dropped" for p in tag_tree.branch(tag))]
    ids = identifiers(explicit)
    if any(pk not in tag_tree.tags for pk in ids):
        raise CommandError("Tag unavailable.", 404)
    tags = [tag_tree.tags[pk] for pk in ids]
    tag_tree.validate_assignments(tags)
    return tags


def set_tags(tree, data):
    fields(data, ["ids", "tagId", "enabled"])
    if type(data["enabled"]) is not bool:
        raise CommandError("Choose whether to apply or remove the tag.")
    tags = TagTree(tree)
    tag = tags.get(data["tagId"])
    items = tree.selected(data["ids"])
    result = Changes([str(item.pk) for item in items])
    groups = tags.exclusive_groups(tag)
    if data["enabled"]:
        tags.validate_assignments([tag])
    for item in items:
        links = ItemTag.objects.filter(workspace=tree.workspace, item=item)
        if data["enabled"]:
            current = set(links.values_list("tag_id", flat=True))
            remove = {pk for pk in current if pk != tag.pk and groups & tags.exclusive_groups(tags.tags[pk])}
            if remove:
                links.filter(tag_id__in=remove).delete()
            changed = bool(remove) or tag.pk not in current
            if tag.pk not in current:
                ItemTag.objects.create(workspace=tree.workspace, item=item, tag=tag)
        else:
            count, _ = links.filter(tag=tag).delete()
            changed = count > 0
        if changed:
            item.version += 1
            item.changed_at = timezone.now()
            item.save(update_fields=["version", "changed_at"])
            result.touch(item)
    return result
