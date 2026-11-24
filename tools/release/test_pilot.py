import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from pilot import stage


class PilotIndexTests(unittest.TestCase):
    def test_publish_and_retry_preserve_the_two_qualified_manifests(self):
        repo = "example.invalid/focuspocus"
        commit = "a" * 40
        digest = "sha256:" + "c" * 64
        children = {"amd64": "sha256:" + "1" * 64, "arm64": "sha256:" + "2" * 64}
        index = {"manifests": [{"platform": {"os": "linux", "architecture": arch}, "digest": child}
                               for arch, child in children.items()]}
        env = {"GITHUB_SHA": commit, "GITHUB_RUN_ID": "120", "GITHUB_RUN_NUMBER": "6", "GITHUB_RUN_ATTEMPT": "2"}
        tag = repo + ":pilot-" + commit + "-120-2"
        directory = Path("qualified")
        with patch.dict(os.environ, env), patch("pilot.stage_image", side_effect=lambda _, arch, *args: children[arch]) as qualify, \
                patch("pilot.inspect_digest", side_effect=[None, digest, digest, digest]), patch("pilot.docker") as docker:
            docker.side_effect = ["", json.dumps(index), json.dumps(index), json.dumps({"manifests": index["manifests"][:1]})]
            self.assertEqual(stage(repo, directory), digest)
            self.assertEqual(stage(repo, directory), digest)
            with self.assertRaisesRegex(ValueError, "tested platform manifests"):
                stage(repo, directory)
            create = [call.args for call in docker.call_args_list if call.args[2] == "create"]
            self.assertEqual(create, [("buildx", "imagetools", "create", "--tag", tag,
                                       repo + "@" + children["amd64"], repo + "@" + children["arm64"])])
            for arch in children:
                qualify.assert_any_call(repo, arch, directory, commit, "pilot-" + commit, "6", "2")
