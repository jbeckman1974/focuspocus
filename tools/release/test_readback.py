import json
import os
import unittest
from unittest.mock import patch

from provenance import RUN_ATTEMPT, RUN_NUMBER
from publish import promote_stable
from readback import readback


def digest(char):
    return "sha256:" + char * 64


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        self.repo = "example.invalid/focuspocus"
        self.version = "v0.1.0"
        self.build = self.version + "-b1-2"
        self.source = "a" * 40
        self.release = {
            "version": self.version, "build": self.build, "source": self.source,
            "version_source": "e" * 40, "run_number": "4", "run_attempt": "2",
            "index": digest("b"), "version_index": digest("a"),
            "platforms": {"amd64": digest("c"), "arm64": digest("d")},
        }
        self.tags = {self.version: digest("a"), self.build: digest("b")}
        self.children = {
            digest("a"): {"amd64": digest("1"), "arm64": digest("2")},
            digest("b"): self.release["platforms"],
        }
        self.configs = {digest("1"): digest("3"), digest("2"): digest("4"),
                        digest("c"): digest("5"), digest("d"): digest("6")}
        self.pulls = []
        self.pulled_arch = "arm64"
        self.labels = {tag: {
            "org.opencontainers.image.revision": source, "org.opencontainers.image.version": self.version,
            RUN_NUMBER: number, RUN_ATTEMPT: attempt,
        } for tag, source, number, attempt in [
            (self.version, self.release["version_source"], "1", "1"),
            (self.build, self.source, "4", "2"),
        ]}
        self.candidate = {"platform": "linux/arm64", "commit": self.source, "digest": digest("d"), "id": digest("6")}

    def registry(self, *args):
        if args[:4] == ("buildx", "imagetools", "inspect", "--raw"):
            ref = args[4].split("@")[1]
            if ref in self.children:
                return json.dumps({"manifests": [
                    {"platform": {"os": "linux", "architecture": arch}, "digest": child}
                    for arch, child in self.children[ref].items()
                ]})
            return json.dumps({"config": {"digest": self.configs[ref]}})
        if args[0] == "pull":
            self.assertEqual(len(args), 2)
            self.pulls.append(args[1])
            return ""
        if args[:2] == ("image", "inspect"):
            tag = args[2].split(":")[1]
            index = self.tags[tag]
            child = self.children[index][self.pulled_arch]
            return json.dumps([{
                "Os": "linux", "Architecture": self.pulled_arch, "Id": self.configs[child],
                "Config": {"Labels": self.labels[tag]}, "RepoDigests": [self.repo + "@" + index],
            }])
        self.fail(f"Unexpected registry command: {args[:2]}")

    def run_readback(self):
        with patch.dict(os.environ, {"DOCKER_DEFAULT_PLATFORM": ""}), \
                patch("readback.docker", side_effect=self.registry), \
                patch("readback.inspect_digest", side_effect=lambda ref: self.tags[ref.split(":")[1]]):
            return readback(self.repo, self.release, "arm64", self.candidate)

    def test_maintenance_build_and_original_version_are_verified_separately(self):
        actual = self.run_readback()
        self.assertEqual([x["child"] for x in actual], [digest("2"), digest("d")])
        self.assertEqual([x["source"] for x in actual], ["e" * 40, self.source])
        self.assertEqual(self.pulls, [self.repo + ":" + tag for tag in (self.version, self.build)])

    def test_default_selection_and_labels_must_match(self):
        self.pulled_arch = "amd64"
        with self.assertRaisesRegex(ValueError, "unexpected image"):
            self.run_readback()
        self.pulled_arch = "arm64"
        self.labels[self.version]["org.opencontainers.image.revision"] = self.source
        with self.assertRaisesRegex(ValueError, "unexpected image"):
            self.run_readback()

    def test_current_build_must_carry_the_qualified_source_and_sequence(self):
        self.labels[self.build]["org.opencontainers.image.revision"] = self.release["version_source"]
        with self.assertRaisesRegex(ValueError, "unexpected image"):
            self.run_readback()
        self.labels[self.build]["org.opencontainers.image.revision"] = self.source
        self.labels[self.build][RUN_ATTEMPT] = "1"
        with self.assertRaisesRegex(ValueError, "build sequence"):
            self.run_readback()

    def test_even_a_valid_manifest_must_match_the_recorded_config_id(self):
        self.candidate["id"] = digest("0")
        with self.assertRaisesRegex(ValueError, "qualification record"):
            self.run_readback()

    def test_moved_tag_blocks_stable_promotion_after_native_validation(self):
        with patch("publish.inspect_digest", return_value=digest("e")), patch("publish.docker") as docker:
            with self.assertRaisesRegex(ValueError, "changed after native readback"):
                promote_stable(self.repo, self.release)
            docker.assert_not_called()
