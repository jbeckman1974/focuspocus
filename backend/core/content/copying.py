from core.history.recording import create_many

from .files import check_capacity
from .models import AttachmentLink, ItemNote


def copy_content(workspace, copies):
    notes = ItemNote.objects.filter(workspace=workspace, item_id__in=copies)
    create_many(ItemNote, [
        ItemNote(workspace=workspace, item=copies[note.item_id], document=note.document, plain_text=note.plain_text)
        for note in notes
    ])
    links = list(AttachmentLink.objects.filter(workspace=workspace, item_id__in=copies).select_related("blob"))
    if links:
        check_capacity(workspace, sum(link.blob.size for link in links))
        create_many(AttachmentLink, [
            AttachmentLink(workspace=workspace, item=copies[link.item_id], blob=link.blob, filename=link.filename)
            for link in links
        ])
