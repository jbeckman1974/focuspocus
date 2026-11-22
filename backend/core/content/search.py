"""Search scoped note projections in PostgreSQL without reading documents or attachment bytes."""

from django.db.models import Q

from .models import ItemNote


def note_matches(workspace, item_ids, terms):
    terms = sorted(set(terms))
    matches = {term: set() for term in terms}
    if not terms or not item_ids:
        return matches
    # Alias names are generated here. The ORM binds search terms as LIKE parameters.
    aliases = {f"term_{index}": Q(plain_text__icontains=term) for index, term in enumerate(terms)}
    notes = ItemNote.objects.filter(workspace=workspace, item__shelf="active", item_id__in=item_ids).annotate(**aliases)
    for key, *flags in notes.values_list("item_id", *aliases).iterator():
        for term, found in zip(terms, flags):
            if found:
                matches[term].add(str(key))
    return matches
