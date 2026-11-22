from functools import wraps

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST

from core.commands.validation import CommandError
from core.commands.views import read_body

from . import capture, members


def session_endpoint(*methods):
    def decorate(handler):
        @require_http_methods(methods)
        @wraps(handler)
        def endpoint(request, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"error": "Login required."}, status=401)
            if request.headers.get("X-FocusPocus-Actor") != str(request.user.pk):
                return JsonResponse({"error": "Refresh the signed-in account."}, status=403)
            try:
                with transaction.atomic():
                    if request.method != "GET":
                        kwargs["body"] = read_body(request)
                        if not isinstance(kwargs["body"], dict):
                            raise CommandError("A JSON object is required.")
                    return JsonResponse(handler(request.user, **kwargs))
            except CommandError as error:
                return JsonResponse({"error": str(error)}, status=error.status)
        return endpoint
    return decorate


@session_endpoint("GET", "POST")
def workspaces(user, body=None):
    if body is not None:
        return members.create_shared(user, body)
    return members.workspaces_for(user)


accept_invitation = session_endpoint("POST")(members.accept_invitation)
roster = session_endpoint("GET")(members.roster)
issue_invitation = session_endpoint("POST")(members.issue_invitation)
revoke_invitation = session_endpoint("POST")(members.revoke_invitation)
change_member = session_endpoint("POST")(members.change_member)
credentials = session_endpoint("GET", "POST")(capture.own_credentials)
revoke_credential = session_endpoint("POST")(capture.revoke_credential)


@csrf_exempt
@require_POST
def bearer_capture(request, *, context=False):
    # Both endpoints accept only a bearer credential. Cookies grant no access.
    try:
        header = request.headers.get("Authorization", "")
        result = (capture.issue_context if context else capture.capture)(header, read_body(request))
        return JsonResponse(result)
    except CommandError as error:
        response = JsonResponse({"error": str(error)}, status=error.status)
        if error.status == 401:
            response["WWW-Authenticate"] = 'Bearer realm="capture"'
        return response
