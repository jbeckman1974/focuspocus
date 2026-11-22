from django.utils import timezone

from core.commands.state import Changes
from core.commands.validation import CommandError, fields, identifier

from .files import prune_retained
from .models import AttachmentLink, ItemNote
from .notes import validate_document


def versioned_item(tree, payload):
    item = tree.get(identifier(payload["id"]))
    if type(payload["itemVersion"]) is not int or payload["itemVersion"] != item.version:
        raise CommandError("Item content changed. Reload and compare the draft.", 412)
    return item


def changed(item):
    item.version += 1
    item.changed_at = timezone.now()
    item.save(update_fields=["version", "changed_at"])
    result = Changes([str(item.pk)])
    result.touch(item)
    return result


def content_command(tree, name, payload):
    if name == "set-note":
        fields(payload, ["id", "itemVersion", "document"])
        item = versioned_item(tree, payload)
        value, plain = validate_document(payload["document"])
        note = ItemNote.objects.filter(workspace=tree.workspace, item=item).first()
        if note and note.document == value or note is None and not plain:
            return Changes([str(item.pk)])
        if note is None:
            ItemNote.objects.create(workspace=tree.workspace, item=item, document=value, plain_text=plain)
        elif not plain:
            note.delete()
        else:
            note.document, note.plain_text = value, plain
            note.save(update_fields=["document", "plain_text"])
    else:
        fields(payload, ["id", "itemVersion", "fileId"])
        item = versioned_item(tree, payload)
        link = AttachmentLink.objects.filter(workspace=tree.workspace, item=item, id=identifier(payload["fileId"])).first()
        if link is None:
            raise CommandError("File unavailable.", 404)
        link.delete()
        prune_retained(tree.workspace)
    return changed(item)
