"""Authenticated reads for archive preview, archived work and recoverable deletion."""

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from core.models import Item

from .service import scoped_workspace
from .shelves import archive_eligible, cutoff
from .state import direct_item
from .validation import CommandError


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
            items = Item.objects.filter(workspace=workspace, shelf=state).order_by("position", "id").prefetch_related("tags")
            result = []
            for item in items:
                if preview and not archive_eligible(item, boundary):
                    continue
                result.append({**direct_item(item), "shelfRootId": str(item.shelf_root) if item.shelf_root else None})
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
