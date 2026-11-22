from .models import ItemNote


def note_texts(workspace, item_ids):
    rows = ItemNote.objects.filter(workspace=workspace, item__shelf="active", item_id__in=item_ids)
    return {str(pk): text for pk, text in rows.values_list("item_id", "plain_text")}
