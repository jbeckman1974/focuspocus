import unittest
from unittest.mock import Mock
from urllib.error import HTTPError

from visibility import verify_private


def status(code):
    return HTTPError("https://ghcr.io", code, "", {}, None)


class PackageVisibilityTests(unittest.TestCase):
    def test_private_package_denies_anonymous_access(self):
        for code in (401, 403):
            read = Mock(side_effect=[{"token": "anonymous"}, status(code)])
            verify_private("owner/repo", "sha256:" + "a" * 64, read)
            self.assertEqual(read.call_count, 2)

    def test_public_package_blocks_staging(self):
        with self.assertRaisesRegex(ValueError, "readable"):
            verify_private("owner/repo", read=Mock(side_effect=[{"token": "anonymous"}, {"tags": []}]))

    def test_missing_is_allowed_only_before_staging_and_outage_is_fatal(self):
        verify_private("owner/repo", read=Mock(side_effect=status(404)))
        for code in (404, 429, 503):
            with self.assertRaises(HTTPError):
                verify_private("owner/repo", "sha256:" + "b" * 64, Mock(side_effect=status(code)))
