import unittest
from unittest.mock import patch

from package_access import check_package, push_empty_marker


class PackageAccessTests(unittest.TestCase):
    def test_missing_or_public_metadata_cannot_release_an_application(self):
        for visibility in (None, "public", "internal"):
            with self.subTest(visibility=visibility), patch("package_access.management_visibility", return_value=visibility), \
                    patch("package_access.push_empty_marker") as push:
                with self.assertRaisesRegex(ValueError, "confirm"):
                    check_package("owner", "sample")
                push.assert_not_called()

    def test_public_package_refuses_even_marker_creation(self):
        with patch("package_access.management_visibility", return_value="public"), \
                patch("package_access.push_empty_marker") as push:
            with self.assertRaisesRegex(ValueError, "public"):
                check_package("owner", "sample", bootstrap=True)
            push.assert_not_called()

    def test_first_boot_sends_only_an_empty_marker_and_requires_exact_anonymous_denial(self):
        digest = "sha256:" + "a" * 64
        with patch("package_access.management_visibility", side_effect=[None, "private"]), \
                patch("package_access.verify_private") as anonymous, patch("package_access.inspect_digest", return_value=digest), \
                patch("package_access.push_empty_marker") as push, patch("builtins.print"):
            check_package("owner", "sample", bootstrap=True)
            push.assert_called_once_with("ghcr.io/owner/sample:visibility-check")
            self.assertEqual(anonymous.call_args.args, ("owner/sample", digest))

    def test_private_metadata_cannot_override_readable_marker(self):
        with patch("package_access.management_visibility", return_value="private"), \
                patch("package_access.inspect_digest", return_value="digest"), \
                patch("package_access.verify_private", side_effect=[None, ValueError("readable")]):
            with self.assertRaisesRegex(ValueError, "readable"):
                check_package("owner", "sample", bootstrap=True)

    def test_marker_build_receives_no_checkout_or_image_layers(self):
        with patch("package_access.subprocess.run") as run:
            push_empty_marker("candidate")
            build, push = run.call_args_list
            self.assertEqual(build.args[0][-1], "-")
            self.assertEqual(build.kwargs["input"].splitlines(),
                             ["FROM scratch", "LABEL org.opencontainers.image.title=package-visibility-check"])
            self.assertEqual(push.args[0], ["docker", "push", "--platform", "linux/amd64", "candidate"])
