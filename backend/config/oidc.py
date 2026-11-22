"""Read the operator's optional single-provider configuration at startup."""

from dataclasses import dataclass, field
import json
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured


@dataclass(frozen=True)
class Provider:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    redirect_uri: str
    client_id: str
    client_secret: str = field(repr=False)
    mfa_acr: str = ""


def load_provider(filename):
    if filename is None:
        return None
    try:
        with Path(filename).open("rb") as stream:
            raw = stream.read(16385)
        if len(raw) > 16384:
            raise ValueError
        provider = Provider(**json.loads(raw))
        for key, value in vars(provider).items():
            if not isinstance(value, str) or (not value and key != "mfa_acr"):
                raise ValueError
            if len(value) > 2048 or any(ord(c) < 32 or ord(c) == 127 for c in value):
                raise ValueError
        for url in (provider.issuer, provider.authorization_endpoint, provider.token_endpoint,
                    provider.jwks_uri, provider.redirect_uri):
            parts = urlsplit(url)
            if (parts.scheme != "https" or not parts.hostname or parts.username is not None
                    or parts.password is not None or parts.query or parts.fragment
                    or any(c.isspace() or c == "\\" for c in url)):
                raise ValueError
            _ = parts.port  # Reject malformed or out-of-range ports.
        if len(provider.issuer) > 512 or urlsplit(provider.redirect_uri).path != "/api/v1/oidc/callback":
            raise ValueError
        return provider
    except (OSError, UnicodeError, ValueError, TypeError):
        raise ImproperlyConfigured("The OIDC provider file is missing or invalid.") from None
