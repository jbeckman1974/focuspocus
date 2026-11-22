from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from core.commands.service import scoped_workspace
from core.commands.validation import CommandError
from core.commands.views import read_body

from .configuration import AdapterError
from .places import locations
from .push import device_settings


@require_http_methods(["GET", "POST"])
def endpoint(request, workspace_id, handler, device=None):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id, write=request.method == "POST" and handler is locations)
            body = read_body(request) if request.method == "POST" else None
            if request.method == "POST" and not isinstance(body, dict):
                raise CommandError("Send a JSON object.")
            result = (device_settings(request.user, device, body) if device is not None
                      else handler(workspace, request.user, body))
        return JsonResponse(result)
    except CommandError as exc:
        return JsonResponse({"error": str(exc)}, status=exc.status)
    except AdapterError:
        return JsonResponse({"error": "The operator needs to check the adapter configuration."}, status=503)
    except IntegrityError as exc:
        # Two accounts/workspaces can concurrently register the same browser endpoint.
        # Programming errors and unrelated integrity failures must remain visible.
        cause = exc.__cause__
        if handler is not device_settings or getattr(cause, "sqlstate", None) != "23505":
            raise
        return JsonResponse({"error": "The resource changed. Refresh and retry."}, status=409)
