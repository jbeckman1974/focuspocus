import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from publish import promote_stable, publish, stage_image, verify_index, verify_previous_version


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.children = {"amd64": "sha256:" + "1" * 64, "arm64": "sha256:" + "2" * 64}
        self.manifests = [
            {"platform": {"os": "linux", "architecture": arch}, "digest": digest}
            for arch, digest in self.children.items()
        ]

    def test_index_requires_both_exact_native_manifests(self):
        verify_index({"manifests": self.manifests}, self.children)
        for bad in (self.manifests[:1], self.manifests * 2, list(reversed(self.manifests))[:1]):
            with self.assertRaises(ValueError):
                verify_index({"manifests": bad}, self.children)
        self.manifests[0]["digest"] = self.children["arm64"]
        with self.assertRaises(ValueError):
            verify_index({"manifests": self.manifests}, self.children)

    def test_candidate_from_another_revision_never_reaches_the_registry(self):
        with TemporaryDirectory() as path, patch("publish.docker") as docker:
            directory = Path(path)
            record = directory / "candidate-amd64"
            record.mkdir()
            (record / "qualified.json").write_text(json.dumps({"commit": "other", "platform": "linux/amd64"}))
            with self.assertRaises(ValueError):
                stage_image("example.invalid/project", "amd64", directory, "expected")
            docker.assert_not_called()

    def test_invalid_release_version_never_loads_candidates(self):
        with patch("publish.stage_image") as stage:
            for version in ("latest", "v01.2.3", "v1.2", "v1.2.3/extra"):
                with self.assertRaises(ValueError):
                    publish("example.invalid/project", version, "1" * 40, "1", "1", Path("."), "1")
            stage.assert_not_called()

    def prior_version(self, sources, version="v1.0.0"):
        output = [json.dumps({"manifests": self.manifests})]
        for arch, source in zip(self.children, sources):
            image = {"Os": "linux", "Architecture": arch, "Config": {"Labels": {
                "org.opencontainers.image.revision": source, "org.opencontainers.image.version": version,
            }}}
            output.extend(["", json.dumps([image])])
        with patch("publish.docker", side_effect=output):
            return verify_previous_version("example.invalid/project", "digest", "v1.0.0", "f" * 40)

    def test_prior_version_must_have_same_reviewed_source_on_both_platforms(self):
        original = "e" * 40
        with patch("publish.require_original_version") as check:
            self.assertEqual(self.prior_version([original, original]), original)
            check.assert_called_once_with(original, "f" * 40, "v1.0.0")
        with self.assertRaisesRegex(ValueError, "different sources"):
            self.prior_version([original, "d" * 40])
        with self.assertRaisesRegex(ValueError, "incompatible version"):
            self.prior_version([original, original], "v0.0.1")

    def test_stable_moves_only_after_version_and_build_readback(self):
        digest = "sha256:" + "a" * 64
        tags = {}

        def registry(*args):
            if args[:2] == ("buildx", "imagetools"):
                if args[2] == "inspect":
                    return json.dumps({"manifests": self.manifests})
                tags[args[4]] = digest
                return ""
            self.fail(f"Unexpected registry command {args[:2]}")

        repo = "example.invalid/project"
        with patch("publish.stage_image", side_effect=list(self.children.values())), \
                patch("publish.docker", side_effect=registry), \
                patch("publish.inspect_digest", side_effect=lambda ref, optional=False: tags.get(ref)), \
                patch("builtins.print"):
            with self.assertRaisesRegex(ValueError, "existing immutable version"):
                publish(repo, "v0.1.0", "f" * 40, "1", "3", Path("."), "1", maintenance=True)
        with patch("publish.stage_image", side_effect=list(self.children.values())), \
                patch("publish.docker", side_effect=registry), \
                patch("publish.inspect_digest", side_effect=lambda ref, optional=False: tags.get(ref)):
            release = publish(repo, "v0.1.0", "f" * 40, "1", "3", Path("."), "1")
            self.assertEqual(release["source"], release["version_source"])
            self.assertNotIn(repo + ":stable", tags)
            promote_stable(repo, release)
        self.assertEqual(list(tags), [repo + suffix for suffix in (":ci-1-3", ":v0.1.0", ":v0.1.0-b1-3", ":stable")])

    def test_maintenance_keeps_original_index_and_records_both_sources(self):
        original = "sha256:" + "a" * 64
        candidate = "sha256:" + "b" * 64
        repo = "example.invalid/project"
        version = "v0.1.0"
        with patch("publish.stage_image", side_effect=self.children.values()), \
                patch("publish.docker", side_effect=["", json.dumps({"manifests": self.manifests}), ""]) as docker, \
                patch("publish.inspect_digest", side_effect=[candidate, original, None, candidate]), \
                patch("publish.verify_previous_version", return_value="c" * 40) as previous:
            release = publish(repo, version, "e" * 40, "22", "1", Path("."), "7", maintenance=True)
        previous.assert_called_once_with(repo, original, version, release["source"])
        self.assertEqual((release["version_index"], release["version_source"]), (original, "c" * 40))
        self.assertEqual((release["index"], release["source"]), (candidate, "e" * 40))
        tagged = [entry.args[4] for entry in docker.call_args_list if entry.args[2] == "create"]
        self.assertEqual(tagged, [repo + ":ci-22-1", repo + ":v0.1.0-b22-1"])
