"""Authenticated reads for archive preview, archived work and recoverable deletion."""

from collections import defaultdict

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from core.models import Item

from .service import scoped_workspace
from .shelves import archive_eligible, cutoff
from .state import direct_item
from .validation import CommandError


def descendant_counts(items):
    children = defaultdict(list)
    for item in items:
        children[item.parent_id].append(item.pk)
    counts = {}
    pending = [(pk, False) for pk in children[None]]
    while pending:
        pk, visited = pending.pop()
        if visited:
            counts[pk] = sum(1 + counts[child] for child in children[pk])
        else:
            pending.append((pk, True))
            pending.extend((child, False) for child in children[pk])
    return counts


def collection(request, workspace_id, preview=False):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id)
            key = "before" if preview else "state"
            if set(request.GET) != {key} or len(request.GET.getlist(key)) != 1:
                raise CommandError("Choose one collection filter.")
            state = "active" if preview else request.GET[key]
            if not preview and state not in ("trash", "archive"):
                raise CommandError("Choose the trash or the archive.")
            boundary = cutoff(request.GET[key], workspace) if preview else None
            items = list(Item.objects.filter(workspace=workspace, shelf=state).order_by("position", "id")
                         .prefetch_related("tags"))
            counts = descendant_counts(items) if preview else {}
            result = []
            for item in items:
                if preview and not archive_eligible(item, boundary):
                    continue
                row = {**direct_item(item), "shelfRootId": str(item.shelf_root) if item.shelf_root else None}
                if preview:
                    row["descendantCount"] = counts[item.pk]
                result.append(row)
            return JsonResponse({"items": result, "revision": workspace.revision})
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)


@never_cache
@require_GET
def shelf(request, workspace_id):
    return collection(request, workspace_id)


@never_cache
@require_GET
def archive_preview(request, workspace_id):
    return collection(request, workspace_id, preview=True)
