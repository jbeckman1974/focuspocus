import base64
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
import secrets
from tempfile import TemporaryDirectory
from time import time
from unittest.mock import patch
from urllib.parse import parse_qs, quote_plus, urlencode, urlsplit

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command, CommandError
from django.test import Client, TestCase
from django.utils import timezone

from config.oidc import Provider, load_provider
from core.auth_services import provision_account
from core.oidc.models import IdentityBinding, LoginChallenge


class Issuer:
    """In-process identity provider with a rotating signing key and a code bound to PKCE."""

    def __init__(self):
        self.config = Provider(
            issuer="https://issuer.example.test/application/o/tasks/",
            authorization_endpoint="https://issuer.example.test/application/o/authorize/",
            token_endpoint="https://issuer.example.test/application/o/token/",
            jwks_uri="https://issuer.example.test/application/o/tasks/jwks/",
            redirect_uri="https://tasks.example.test/api/v1/oidc/callback",
            client_id=secrets.token_urlsafe(16), client_secret=secrets.token_urlsafe(30),
        )
        self.subject = secrets.token_hex(15)
        self.codes = {}
        self.exchanges = 0
        self.claims = {}
        self.rotate()

    def rotate(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = secrets.token_hex(6)

    def authorize(self, response):
        location = response["Location"]
        if response.status_code != 302 or location.partition("?")[0] != self.config.authorization_endpoint:
            raise AssertionError("Unexpected authorization response")
        parameters = dict((k, v[0]) for k, v in parse_qs(urlsplit(location).query).items())
        assert parameters["response_type"] == "code" and parameters["scope"] == "openid"
        assert parameters["code_challenge_method"] == "S256" and parameters["redirect_uri"] == self.config.redirect_uri
        assert parameters["client_id"] == self.config.client_id
        code = secrets.token_urlsafe(24)
        self.codes[code] = parameters
        return {"code": code, "state": parameters["state"]}

    def respond(self, url, *, body=None, headers=None):
        if url == self.config.jwks_uri:
            key = jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key(), as_dict=True)
            return {"keys": [{**key, "kid": self.kid, "use": "sig"}]}
        assert url == self.config.token_endpoint
        credentials = f"{quote_plus(self.config.client_id)}:{quote_plus(self.config.client_secret)}"
        assert headers["Authorization"] == "Basic " + base64.b64encode(credentials.encode()).decode()
        request = parse_qs(body.decode("ascii"))
        assert request["grant_type"] == ["authorization_code"] and request["redirect_uri"] == [self.config.redirect_uri]
        staged = self.codes.pop(request["code"][0])
        expected = base64.urlsafe_b64encode(sha256(request["code_verifier"][0].encode()).digest()).rstrip(b"=").decode()
        assert staged["code_challenge"] == expected
        self.exchanges += 1
        now = int(time())
        claims = {
            "iss": self.config.issuer, "sub": self.subject, "aud": self.config.client_id,
            "azp": self.config.client_id, "nonce": staged["nonce"], "iat": now, "exp": now + 180,
            "amr": ["mfa"], **self.claims,
        }
        return {"id_token": jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": self.kid})}


class ProviderSigninTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.username = secrets.token_hex(8)
        cls.password = secrets.token_urlsafe(30)
        cls.user = provision_account(cls.username, cls.password)

    def setUp(self):
        self.issuer = Issuer()
        self.provider = self.issuer.config
        self.browser = Client(enforce_csrf_checks=True)
        self.client_policy = self.settings(OIDC_PROVIDER=self.provider,
                                           AUTHENTICATION_BACKENDS=["core.oidc.backend.ProviderBackend"])
        self.client_policy.enable()
        self.addCleanup(self.client_policy.disable)
        transport = patch("core.oidc.provider.request_json", side_effect=self.issuer.respond)
        transport.start()
        self.addCleanup(transport.stop)
        self.binding = IdentityBinding.objects.create(
            issuer=self.provider.issuer, subject=self.issuer.subject, user=self.user,
        )

    def session(self):
        return self.browser.get("/api/v1/session").json()

    def begin(self):
        response = self.browser.post("/api/v1/oidc/start", HTTP_X_CSRFTOKEN=self.session()["csrfToken"])
        return self.issuer.authorize(response)

    def finish(self, query, browser=None):
        return (browser or self.browser).get("/api/v1/oidc/callback?" + urlencode(query))

    def test_code_flow_key_rotation_and_disabled_password_routes(self):
        self.assertEqual(self.session()["authMode"], "oidc")
        self.assertEqual(self.browser.post("/api/v1/oidc/start").status_code, 403)
        for endpoint in ("login", "recover"):
            self.assertEqual(self.browser.post("/api/v1/" + endpoint, {},
                                               HTTP_X_CSRFTOKEN=self.session()["csrfToken"]).status_code, 403)
        for _ in range(2):
            self.issuer.rotate()
            query = self.begin()
            self.assertEqual(self.finish(query)["Location"], "/app/")
            self.assertEqual(self.session()["user"]["id"], self.user.pk)
            self.assertEqual(self.finish(query)["Location"], "/app/?signin=failed")
            self.browser.post("/api/v1/logout", HTTP_X_CSRFTOKEN=self.session()["csrfToken"])
        self.assertEqual(self.issuer.exchanges, 2)

    def test_wrong_session_state_expiry_and_cancel_do_not_exchange(self):
        query = self.begin()
        for browser, values in ((Client(), query), (self.browser, {**query, "state": secrets.token_urlsafe(32)})):
            self.assertEqual(self.finish(values, browser)["Location"], "/app/?signin=failed")
        self.assertEqual(LoginChallenge.objects.count(), 1)
        self.finish({**query, "error": "access_denied"})
        self.assertFalse(LoginChallenge.objects.exists())
        self.finish(query)
        expired = self.begin()
        LoginChallenge.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
        self.finish(expired)
        self.assertEqual(self.issuer.exchanges, 0)
        self.assertIsNone(self.session()["user"])

    def test_id_token_must_identify_the_right_provider_client_factor_and_subject(self):
        for claims in (
            {"iss": "https://other.example.test/"}, {"aud": "other-client"}, {"azp": "other-client"},
            {"aud": [self.provider.client_id, "untrusted"]}, {"nonce": secrets.token_urlsafe(24)},
            {"amr": ["pwd"]}, {"amr": "mfa"}, {"exp": int(time()) - 10}, {"iat": int(time()) + 300},
            {"sub": self.issuer.subject + "x", "email": self.username},
        ):
            with self.subTest(fields=list(claims)):
                self.issuer.claims = claims
                self.assertEqual(self.finish(self.begin())["Location"], "/app/?signin=failed")
        self.assertIsNone(self.session()["user"])

    def test_required_acr_and_reloaded_binding(self):
        provider = replace(self.provider, mfa_acr="urn:example:two-factors")
        with self.settings(OIDC_PROVIDER=provider):
            self.assertEqual(self.finish(self.begin())["Location"], "/app/?signin=failed")
            self.issuer.claims = {"acr": provider.mfa_acr}
            self.assertEqual(self.finish(self.begin())["Location"], "/app/")
            self.binding.delete()
            self.assertIsNone(self.session()["user"])

    def test_live_provider_session_is_fenced_by_an_updated_mfa_policy(self):
        self.assertEqual(self.finish(self.begin())["Location"], "/app/")
        with self.settings(OIDC_PROVIDER=replace(self.provider, mfa_acr="urn:example:new-mfa")):
            self.assertIsNone(self.session()["user"])
        self.assertIsNone(self.session()["user"])

    def test_local_session_cannot_survive_switch_to_provider_only(self):
        with self.settings(OIDC_PROVIDER=None, AUTHENTICATION_BACKENDS=["django.contrib.auth.backends.ModelBackend"]):
            csrf = self.session()["csrfToken"]
            response = self.browser.post("/api/v1/login", {"username": self.username, "password": self.password},
                                         content_type="application/json", HTTP_X_CSRFTOKEN=csrf)
            self.assertEqual(response.json()["user"]["id"], self.user.pk)
            self.assertEqual(self.browser.get("/api/v1/oidc/callback").status_code, 404)
        self.assertIsNone(self.session()["user"])

    def test_command_is_idempotent_and_cannot_reassign_existing_bindings(self):
        call_command("bind_oidc_identity", self.username, self.issuer.subject, stdout=StringIO())
        other = provision_account(secrets.token_hex(8), secrets.token_urlsafe(35))
        with self.assertRaises(CommandError):
            call_command("bind_oidc_identity", other.username, self.issuer.subject, stdout=StringIO())
        with self.assertRaises(CommandError):
            call_command("bind_oidc_identity", self.username, secrets.token_hex(8), stdout=StringIO())
        self.assertEqual(IdentityBinding.objects.count(), 1)

    def test_config_rejects_unsafe_endpoint_and_incomplete_file(self):
        self.assertIsNone(load_provider(None))
        with TemporaryDirectory() as directory:
            path = Path(directory) / "provider.json"
            path.write_text(json.dumps(vars(self.provider)))
            self.assertEqual(load_provider(path), self.provider)
            for patch_values in (
                {"issuer": "http://issuer.example.test"}, {"redirect_uri": "https://tasks.example.test/other"},
                {"token_endpoint": "https://user@issuer.example.test/token"}, {"client_secret": ""},
            ):
                path.write_text(json.dumps({**vars(self.provider), **patch_values}))
                with self.assertRaises(ImproperlyConfigured):
                    load_provider(path)
