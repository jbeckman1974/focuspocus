import json

from django.contrib import auth
from django.conf import settings
from django.core.exceptions import RequestDataTooBig, ValidationError
from django.http import JsonResponse
from django.middleware.csrf import get_token, rotate_token
from django.views.decorators.http import require_GET, require_POST

from .auth_services import allow_attempt, redeem
from .models import Membership


def csrf_failure(request, reason=""):
    return JsonResponse({"error": "Refresh your session and try again."}, status=403)


def session_payload(request):
    user = request.user
    memberships = []
    if user.is_authenticated:
        memberships = [
            {"id": str(workspace_id), "role": role}
            for workspace_id, role in Membership.objects.filter(user=user)
            .order_by("workspace_id").values_list("workspace_id", "role")
        ]
    return {
        "authMode": "oidc" if settings.OIDC_PROVIDER else "local",
        "user": {"id": user.pk, "username": user.get_username()} if user.is_authenticated else None,
        "workspaces": memberships,
        "csrfToken": get_token(request),
    }


@require_GET
def session_info(request):
    return JsonResponse(session_payload(request))


def credentials(request, first):
    if request.content_type != "application/json":
        return None
    try:
        raw = request.body
        if len(raw) > 16 * 1024:
            return None
        body = json.loads(raw)
    except (ValueError, UnicodeError, RequestDataTooBig, RecursionError):
        return None
    if not isinstance(body, dict) or set(body) != {first, "password"}:
        return None
    key, password = body[first], body["password"]
    if not isinstance(key, str) or not 0 < len(key) <= 150:
        return None
    if not isinstance(password, str) or not 0 < len(password) <= 4096:
        return None
    if "\x00" in key or "\x00" in password:
        return None
    try:
        key.encode("utf-8")
        password.encode("utf-8")
    except UnicodeEncodeError:
        return None
    return key, password


def throttled():
    response = JsonResponse({"error": "Too many attempts. Try again later."}, status=429)
    response["Retry-After"] = "600"
    return response


@require_POST
def login(request):
    if settings.OIDC_PROVIDER:
        return JsonResponse({"error": "Use the configured identity provider."}, status=403)
    pair = credentials(request, "username")
    if pair is None:
        return JsonResponse({"error": "Supply a username and password."}, status=400)
    username, password = pair
    if not allow_attempt("login-ip", request.META.get("REMOTE_ADDR", ""), 120):
        return throttled()
    if not allow_attempt("login-user", username.casefold(), 12):
        return throttled()
    user = auth.authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"error": "The credentials were not accepted."}, status=401)
    auth.login(request, user)
    return JsonResponse(session_payload(request))


@require_POST
def logout(request):
    auth.logout(request)
    rotate_token(request)
    return JsonResponse(session_payload(request))


@require_POST
def recover(request):
    if settings.OIDC_PROVIDER:
        return JsonResponse({"error": "Recover access through the configured identity provider."}, status=403)
    pair = credentials(request, "token")
    if pair is None:
        return JsonResponse({"error": "Supply a recovery token and new password."}, status=400)
    if not allow_attempt("recovery-ip", request.META.get("REMOTE_ADDR", ""), 40):
        return throttled()
    try:
        valid = redeem(*pair)
    except ValidationError as error:
        return JsonResponse({"error": " ".join(error.messages)}, status=400)
    if not valid:
        return JsonResponse({"error": "The recovery token is invalid or expired."}, status=400)
    auth.logout(request)
    rotate_token(request)
    return JsonResponse(session_payload(request))
