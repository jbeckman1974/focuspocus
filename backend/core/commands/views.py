import json

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods, require_POST

from .service import etag, execute, scoped_workspace
from .state import Outline, direct_item
from .validation import CommandError


def read_body(request):
    if request.content_type != "application/json":
        raise CommandError("Send a JSON object.", 415)
    try:
        return json.loads(request.body.decode("utf-8"))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise CommandError("Malformed JSON.", 400) from error


def submit(request, workspace_id, name, *, item_id=None):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required."}, status=401)
    try:
        body = read_body(request)
        result = execute(
            request.user, workspace_id, name, body, item_id=item_id,
            if_match=request.headers.get("If-Match"),
        )
        return JsonResponse(result)
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
    except IntegrityError as error:
        # Only a uniqueness failure is a normal client-selected identifier
        # collision. Unexpected schema or integrity errors must reach monitoring.
        if getattr(error.__cause__, "sqlstate", None) != "23505":
            raise
        return JsonResponse({"error": "An identifier is unavailable."}, status=409)


@require_POST
def command(request, workspace_id, name):
    return submit(request, workspace_id, name)


@require_http_methods(["GET", "PATCH"])
def item_detail(request, workspace_id, item_id):
    if request.method == "PATCH":
        return submit(request, workspace_id, "patch", item_id=item_id)
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id)
            item = Outline(workspace).get(item_id)
            response = JsonResponse(direct_item(item))
            response["ETag"] = etag(item)
            return response
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
