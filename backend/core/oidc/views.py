from urllib.parse import urlencode

from django.conf import settings
from django.contrib import auth
from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from core.auth_services import allow_attempt
from . import challenge
from .backend import PROVIDER_BACKEND
from .models import IdentityBinding
from .provider import exchange, IdentityError, verified_subject


def redirect(destination):
    response = HttpResponseRedirect(destination)
    response["Referrer-Policy"] = "no-referrer"
    return response


@require_POST
def start(request):
    provider = settings.OIDC_PROVIDER
    if not provider:
        return JsonResponse({"error": "Provider sign-in is disabled."}, status=404)
    if request.user.is_authenticated:
        return redirect("/app/")
    if not allow_attempt("oidc-start", request.META.get("REMOTE_ADDR", ""), 120):
        return JsonResponse({"error": "Too many sign-in attempts."}, status=429)
    state, nonce, proof = challenge.start(request.session, provider)
    params = {
        "response_type": "code", "scope": "openid", "client_id": provider.client_id,
        "redirect_uri": provider.redirect_uri, "state": state, "nonce": nonce,
        "code_challenge": proof, "code_challenge_method": "S256",
    }
    if provider.mfa_acr:
        params["acr_values"] = provider.mfa_acr
    return redirect(provider.authorization_endpoint + "?" + urlencode(params))


@require_GET
def callback(request):
    provider = settings.OIDC_PROVIDER
    if not provider:
        return JsonResponse({"error": "Provider sign-in is disabled."}, status=404)
    failure = redirect("/app/?signin=failed")
    states, codes = request.GET.getlist("state"), request.GET.getlist("code")
    if len(states) != 1:
        return failure
    pending = challenge.consume(request.session, provider, states[0])
    if not pending or "error" in request.GET or len(codes) != 1 or not 0 < len(codes[0]) <= 4096:
        return failure
    if "iss" in request.GET and request.GET.getlist("iss") != [provider.issuer]:
        return failure
    nonce, verifier = pending
    try:
        subject = verified_subject(provider, exchange(provider, codes[0], verifier), nonce)
    except IdentityError:
        return failure
    binding = IdentityBinding.objects.select_related("user").filter(
        issuer=provider.issuer, subject=subject, user__is_active=True,
    ).first()
    if binding is None:
        return failure
    request.session.pop("oidc_browser", None)
    auth.login(request, binding.user, backend=PROVIDER_BACKEND)
    request.session["oidc_policy"] = challenge.policy_id(provider)
    request.session["oidc_binding"] = binding.pk
    return redirect("/app/")
