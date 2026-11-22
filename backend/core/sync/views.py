from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from core.access import locked_membership
from core.commands.validation import CommandError
from core.queries.outline import options, project_outline
from core.queries.records import read_records

from . import feed
from .health import schema_ready


@never_cache
@require_GET
def workspace_read(request, workspace_id, mode):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "authentication_required"}, status=401)
    with transaction.atomic():
        workspace, _ = locked_membership(request.user, workspace_id)
        if workspace is None:
            return JsonResponse({"error": "not_found"}, status=404)
        if mode == "snapshot":
            payload = feed.snapshot(workspace, request.user)
        elif mode == "outline":
            try:
                view, availability, project_id, tag_id, folder_id = options(request.GET)
                rows, tags = read_records(workspace)
                projection = project_outline(rows, tags, view=view, availability=availability,
                                             project_id=project_id, tag_id=tag_id, folder_id=folder_id)
            except CommandError as error:
                return JsonResponse({"error": str(error)}, status=error.status)
            payload = {"workspaceId": str(workspace.pk), "revision": workspace.revision, **projection}
        else:
            try:
                limit = int(request.GET.get("limit", feed.PAGE_SIZE))
                if not 1 <= limit <= feed.PAGE_SIZE:
                    raise ValueError
            except ValueError:
                return JsonResponse({"error": "invalid_limit"}, status=400)
            try:
                payload = feed.changes_since(
                    workspace, request.user, request.GET.get("after"), limit
                )
            except feed.StaleCursor:
                return JsonResponse({"error": "snapshot_required"}, status=410)
    return JsonResponse(payload)


@never_cache
@require_GET
def live(request):
    return JsonResponse({"status": "live"})


@never_cache
@require_GET
def ready(request):
    try:
        healthy = schema_ready()
    except DatabaseError:
        healthy = False
    return JsonResponse({"status": "ready" if healthy else "unavailable"}, status=200 if healthy else 503)
