import unittest
from pathlib import Path
from unittest.mock import patch

from package_access import check_package


def job_body(workflow, name):
    body = workflow.split("\n  " + name + ":\n", 1)[1]
    lines = []
    for line in body.splitlines():
        if line.startswith("  ") and not line.startswith("    "):
            break
        lines.append(line)
    return "\n".join(lines)


class PackageAccessTests(unittest.TestCase):
    def test_every_registry_job_establishes_its_own_session(self):
        workflow = Path(".github/workflows/release.yml").read_text()
        native_job = Path(".github/workflows/qualify-platform.yml").read_text()
        self.assertIn("bash tools/release/check-session.sh", native_job)
        for job in ("package-access", "publish", "readback", "promote"):
            with self.subTest(job=job):
                self.assertIn("bash tools/release/check-session.sh", job_body(workflow, job))
        session = Path("tools/release/check-session.sh").read_text()
        self.assertLess(session.index("docker login"), session.index("package_access.py"))

    def test_release_checks_native_amd64_before_staging_either_platform(self):
        release = Path(".github/workflows/release.yml").read_text()
        native = Path(".github/workflows/qualify-platform.yml").read_text()
        for job, prior, arch in (
            ("qualify", "package-access", "amd64"), ("qualify-arm64", "qualify", "arm64"),
        ):
            section = job_body(release, job)
            self.assertIn("needs: " + prior, section)
            self.assertIn("uses: ./.github/workflows/qualify-platform.yml", section)
            self.assertIn("platform: " + arch, section)
        self.assertIn("needs: [qualify, qualify-arm64]", release)
        for check in ("bash ops/verify-stack.sh", "bash ops/verify-readiness.sh performance",
                      "bash ops/verify-readiness.sh accessibility", "bash ops/verify-readiness.sh pg-upgrade"):
            self.assertLess(native.index(check), native.index("docker push"))
        self.assertIn('if [[ "$PLATFORM" == amd64 ]]', native)
        self.assertIn("name: candidate-${{ inputs.platform }}", native)

    def test_missing_marker_stops_before_any_write(self):
        with patch("package_access.management_visibility", return_value=None), \
                patch("package_access.inspect_digest", return_value=None) as inspect, \
                patch("package_access.verify_private") as anonymous:
            with self.assertRaisesRegex(ValueError, "pre-provisioned"):
                check_package("owner", "sample")
            inspect.assert_called_once()
            anonymous.assert_not_called()

    def test_public_or_internal_metadata_blocks_registry_access(self):
        for visibility in ("public", "internal"):
            with self.subTest(visibility=visibility), patch("package_access.management_visibility", return_value=visibility), \
                    patch("package_access.inspect_digest") as inspect:
                with self.assertRaisesRegex(ValueError, visibility):
                    check_package("owner", "sample")
                inspect.assert_not_called()

    def test_positive_authenticated_access_and_anonymous_denial_are_both_required(self):
        digest = "sha256:" + "a" * 64
        for metadata in (None, "private"):
            with self.subTest(metadata=metadata), patch("package_access.management_visibility", return_value=metadata), \
                    patch("package_access.inspect_digest", side_effect=[digest, digest]) as inspect, \
                    patch("package_access.verify_private") as anonymous, patch("builtins.print"):
                check_package("owner", "sample")
                self.assertEqual(inspect.call_args.args, ("ghcr.io/owner/sample@" + digest,))
                self.assertEqual(anonymous.call_args.args, ("owner/sample", digest))
                self.assertEqual(anonymous.call_count, 2)

    def test_anonymously_readable_marker_stops_even_with_private_metadata(self):
        digest = "sha256:" + "b" * 64
        with patch("package_access.management_visibility", return_value="private"), \
                patch("package_access.inspect_digest", return_value=digest), \
                patch("package_access.verify_private", side_effect=[None, ValueError("readable")]):
            with self.assertRaisesRegex(ValueError, "readable"):
                check_package("owner", "sample")

    def test_marker_must_resolve_to_the_same_immutable_manifest(self):
        with patch("package_access.management_visibility", return_value=None), \
                patch("package_access.inspect_digest", side_effect=["sha256:" + "a" * 64, "sha256:" + "b" * 64]):
            with self.assertRaisesRegex(ValueError, "immutable"):
                check_package("owner", "sample")
