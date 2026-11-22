"""Read each planning view under the same membership and revision lock as writes."""

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from core.commands.service import scoped_workspace
from core.commands.validation import CommandError


@never_cache
@require_GET
def planning_view(request, workspace_id, query):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id)
            payload = query(workspace, request.user, request.GET)
        return JsonResponse(payload)
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
