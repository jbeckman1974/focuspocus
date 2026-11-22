"""Bounded HTTPS calls and ID token validation for the configured provider."""

import base64
from http.client import HTTPException, HTTPSConnection
import json
from secrets import compare_digest
from time import monotonic
from urllib.parse import quote_plus, urlencode, urlsplit

import jwt


class IdentityError(ValueError):
    """Safe to report a generic sign-in failure. Provider details stay private."""


def request_json(url, *, body=None, headers=None):
    target = urlsplit(url)
    connection = HTTPSConnection(target.hostname, target.port, timeout=5)
    deadline = monotonic() + 10
    try:
        connection.request("GET" if body is None else "POST", target.path or "/", body, headers or {})
        response = connection.getresponse()
        if response.status != 200:
            raise IdentityError()
        parts = bytearray()
        while len(parts) <= 131072 and monotonic() < deadline:
            chunk = response.read1(min(16384, 131073 - len(parts)))
            if not chunk:
                value = json.loads(parts)
                if isinstance(value, dict):
                    return value
                break
            parts.extend(chunk)
        raise IdentityError()
    except (OSError, HTTPException, UnicodeError, ValueError, RecursionError):
        raise IdentityError() from None
    finally:
        connection.close()


def subject_valid(value):
    return isinstance(value, str) and 1 <= len(value) <= 255 and all(32 <= ord(c) < 127 for c in value)


def exchange(provider, code, verifier):
    credentials = quote_plus(provider.client_id) + ":" + quote_plus(provider.client_secret)
    basic = base64.b64encode(credentials.encode("ascii")).decode("ascii")
    data = urlencode({"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                      "redirect_uri": provider.redirect_uri}).encode("ascii")
    return request_json(provider.token_endpoint, body=data, headers={
        "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }).get("id_token")


def signing_key(provider, token):
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not isinstance(kid, str) or not 1 <= len(kid) <= 256 or header.get("alg") != "RS256" or "crit" in header:
        raise IdentityError()
    keys = request_json(provider.jwks_uri).get("keys")
    if not isinstance(keys, list) or len(keys) > 64:
        raise IdentityError()
    candidates = [key for key in keys if isinstance(key, dict) and key.get("kid") == kid
                  and key.get("kty") == "RSA" and key.get("use", "sig") == "sig"
                  and key.get("alg", "RS256") == "RS256"
                  and isinstance(key.get("key_ops", []), list) and "verify" in key.get("key_ops", ["verify"])]
    if len(candidates) != 1:
        raise IdentityError()
    key = jwt.PyJWK.from_dict(candidates[0], algorithm="RS256").key
    if not 2048 <= key.key_size <= 8192:
        raise IdentityError()
    return key


def verified_subject(provider, token, nonce):
    if not isinstance(token, str) or not 1 <= len(token) <= 32768 or not token.isascii():
        raise IdentityError()
    try:
        claims = jwt.decode(token, signing_key(provider, token), algorithms=["RS256"],
                            audience=provider.client_id, issuer=provider.issuer,
                            options={"require": ["iss", "sub", "aud", "exp", "iat", "nonce"]})
        if (claims["aud"] not in (provider.client_id, [provider.client_id])
                or claims.get("azp", provider.client_id) != provider.client_id
                or not isinstance(claims["nonce"], str) or not claims["nonce"].isascii()
                or not compare_digest(claims["nonce"], nonce) or not subject_valid(claims["sub"])):
            raise IdentityError()
        if provider.mfa_acr:
            mfa = claims.get("acr") == provider.mfa_acr
        else:
            methods = claims.get("amr")
            mfa = isinstance(methods, list) and "mfa" in methods
        if not mfa:
            raise IdentityError()
        return claims["sub"]
    except (jwt.PyJWTError, ValueError, TypeError, AttributeError, KeyError, OverflowError):
        raise IdentityError() from None
