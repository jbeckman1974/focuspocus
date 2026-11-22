"""Search scoped note projections in PostgreSQL without reading documents or attachment bytes."""

from django.db.models import Q

from .models import ItemNote


def note_matches(workspace, terms, *, item_ids=None):
    terms = sorted(set(terms))
    matches = {term: set() for term in terms}
    if not terms:
        return matches
    notes = ItemNote.objects.filter(workspace=workspace, item__workspace=workspace, item__shelf="active")
    if item_ids is not None:
        notes = notes.filter(item_id__in=item_ids)
    if len(terms) == 1:
        term = terms[0]
        keys = notes.filter(plain_text__icontains=term).values_list("item_id", flat=True)
        matches[term].update(str(key) for key in keys.iterator())
        return matches
    # Alias names are generated here. The ORM binds search terms as LIKE parameters.
    aliases = {f"term_{index}": Q(plain_text__icontains=term) for index, term in enumerate(terms)}
    for key, *flags in notes.annotate(**aliases).values_list("item_id", *aliases).iterator():
        for term, found in zip(terms, flags):
            if found:
                matches[term].add(str(key))
    return matches
