from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import BaseBackend
from django.db.models import F

from .challenge import policy_id


PROVIDER_BACKEND = "core.oidc.backend.ProviderBackend"


class ProviderBackend(BaseBackend):
    """Django session reader for accounts admitted by the verified OIDC callback."""

    def get_user(self, user_id):
        provider = settings.OIDC_PROVIDER
        if provider:
            return get_user_model().objects.filter(
                pk=user_id, is_active=True, identitybinding__issuer=provider.issuer,
            ).annotate(oidc_binding_id=F("identitybinding__pk")).first()
        return None


class ProviderSessionMiddleware:
    """Fence a session established under a different identity binding or MFA policy."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.contrib.auth import BACKEND_SESSION_KEY, logout

        backend = request.session.get(BACKEND_SESSION_KEY)
        if backend:
            provider = settings.OIDC_PROVIDER
            provider_login = backend == PROVIDER_BACKEND
            if provider_login != bool(provider) or (provider_login and (
                request.session.get("oidc_policy") != policy_id(provider) or not request.user.is_authenticated
                or request.session.get("oidc_binding") != getattr(request.user, "oidc_binding_id", None)
            )):
                logout(request)
        return self.get_response(request)
