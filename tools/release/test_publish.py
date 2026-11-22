import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from publish import publish, stage_image, verify_index


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
                stage_image("example.invalid/project", "amd64", directory, "expected", "build")
            docker.assert_not_called()

    def test_invalid_release_version_never_loads_candidates(self):
        with patch("publish.stage_image") as stage:
            for version in ("latest", "v01.2.3", "v1.2", "v1.2.3/extra"):
                with self.assertRaises(ValueError):
                    publish("example.invalid/project", version, "1" * 40, "1", "1", Path("."))
            stage.assert_not_called()
