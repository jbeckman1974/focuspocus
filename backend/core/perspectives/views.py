from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from core.commands.service import scoped_workspace
from core.commands.validation import CommandError
from core.commands.views import read_body

from .query import query
from .service import personal_state, serialize, write


@never_cache
@require_http_methods(["GET", "POST"])
def endpoint(request, workspace_id, mode):
    if (request.method == "GET") != (mode == "list"):
        return JsonResponse({"error": "Method unavailable."}, status=405)
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id)
            if mode == "list":
                result = serialize(personal_state(request.user, workspace))
            elif mode == "query":
                result = query(request.user, workspace, read_body(request))
            else:
                result = write(request.user, workspace, read_body(request))
        return JsonResponse(result)
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
