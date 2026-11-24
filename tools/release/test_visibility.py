import hashlib
import json
import os
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from visibility import MANIFEST_TYPES, PUBLIC_PACKAGE, public_package, verify_public


class PublicPackageTests(unittest.TestCase):
    def test_destination_requires_the_workflow_repository_and_declared_public_package(self):
        env = {"GITHUB_REPOSITORY_OWNER": "JBeckman1974", "GITHUB_REPOSITORY": "JBeckman1974/FocusPocus"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(public_package(), PUBLIC_PACKAGE)
            with patch("visibility.Path.read_text", return_value="another-package"):
                with self.assertRaisesRegex(ValueError, "repository"):
                    public_package()
            with patch.dict(os.environ, {"GITHUB_REPOSITORY": "other/focuspocus"}):
                with self.assertRaisesRegex(ValueError, "repository"):
                    public_package()

    def test_list_uses_only_an_anonymous_pull_token_for_the_exact_repository(self):
        listing = json.dumps({"name": PUBLIC_PACKAGE, "tags": ["ci-example"]}).encode()
        read = Mock(side_effect=[b'{"token":"anonymous"}', listing])
        verify_public(PUBLIC_PACKAGE, read=read)
        request = read.call_args_list[0]
        self.assertEqual(request.kwargs, {})
        token = urlsplit(request.args[0])
        self.assertEqual(token.path, "token")
        self.assertEqual(parse_qs(token.query), {"service": ["ghcr.io"], "scope": ["repository:" + PUBLIC_PACKAGE + ":pull"]})
        read.assert_called_with(f"v2/{PUBLIC_PACKAGE}/tags/list?n=1", token="anonymous")

    def test_anonymous_tag_and_immutable_reads_hash_the_served_manifest_bytes(self):
        raw = b'{"schemaVersion":2, "manifests":[]}\n'
        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
        for reference in ("v0.1.0", digest):
            with self.subTest(reference=reference):
                read = Mock(side_effect=[b'{"token":"anonymous"}', raw])
                verify_public(PUBLIC_PACKAGE, reference, digest, read=read)
                read.assert_called_with(f"v2/{PUBLIC_PACKAGE}/manifests/{reference}", token="anonymous", accept=MANIFEST_TYPES)
        with self.assertRaisesRegex(ValueError, "qualified digest"):
            verify_public(PUBLIC_PACKAGE, "stable", digest, read=Mock(side_effect=[b'{"token":"anonymous"}', raw.strip()]))

    def test_read_denial_missing_resources_and_outages_stop_qualification(self):
        for code in (401, 403, 404, 429, 503):
            for token_received in (False, True):
                with self.subTest(code=code, token_received=token_received):
                    denied = HTTPError("https://ghcr.io", code, "", {}, None)
                    replies = [b'{"token":"anonymous"}', denied] if token_received else [denied]
                    with self.assertRaises(HTTPError):
                        verify_public(PUBLIC_PACKAGE, "version", "sha256:" + "a" * 64, read=Mock(side_effect=replies))
        for listing in ({"name": "other/sample", "tags": []}, {"name": PUBLIC_PACKAGE}):
            with self.assertRaisesRegex(ValueError, "unexpected package"):
                verify_public(PUBLIC_PACKAGE, read=Mock(side_effect=[b'{"token":"anonymous"}', json.dumps(listing).encode()]))

    def test_invalid_destination_manifest_reference_and_digest_do_not_contact_registry(self):
        digest = "sha256:" + "a" * 64
        for package, reference, expected in (
            ("other/sample", None, None), (PUBLIC_PACKAGE, "v1", None), (PUBLIC_PACKAGE, None, digest),
            (PUBLIC_PACKAGE, "stable", "invalid"), (PUBLIC_PACKAGE, "another/path", digest),
            (PUBLIC_PACKAGE, "sha256:" + "b" * 64, digest),
        ):
            read = Mock()
            with self.subTest(package=package, reference=reference), self.assertRaises(ValueError):
                verify_public(package, reference, expected, read=read)
            read.assert_not_called()
