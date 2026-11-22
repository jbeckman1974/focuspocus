from io import BytesIO
import json
import secrets
from time import time
from unittest.mock import MagicMock, patch

import jwt
from django.test import SimpleTestCase

from core.oidc.provider import IdentityError, request_json, verified_subject
from core.tests.test_oidc_signin import Issuer


class ProviderTransportTests(SimpleTestCase):
    def test_backchannel_does_not_follow_redirects_or_read_unbounded_json(self):
        connection = MagicMock()
        response = connection.getresponse.return_value
        with patch("core.oidc.provider.HTTPSConnection", return_value=connection) as connect:
            response.status = 307
            with self.assertRaises(IdentityError):
                request_json("https://issuer.example.test/token", body=b"form")
            connect.assert_called_once()
            response.read1.assert_not_called()
            response.status = 200
            stream = BytesIO(json.dumps({"data": "x" * 140000}).encode())
            response.read1.side_effect = stream.read1
            with self.assertRaises(IdentityError):
                request_json("https://issuer.example.test/jwks")
            self.assertEqual(stream.tell(), 131073)
            self.assertEqual(connection.close.call_count, 2)

    def test_signing_key_must_match_both_the_registered_provider_and_key_id(self):
        issuer = Issuer()
        other = Issuer()
        nonce = secrets.token_urlsafe(18)
        now = int(time())
        claims = {
            "iss": issuer.config.issuer, "sub": issuer.subject, "aud": issuer.config.client_id,
            "iat": now, "exp": now + 60, "nonce": nonce, "amr": ["mfa"],
        }
        key_set = issuer.respond(issuer.config.jwks_uri)
        with patch("core.oidc.provider.request_json", return_value=key_set):
            for key, kid in ((issuer.key, other.kid), (other.key, issuer.kid)):
                token = jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})
                with self.assertRaises(IdentityError):
                    verified_subject(issuer.config, token, nonce)
