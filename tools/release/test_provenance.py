import json
import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from provenance import RUN_ATTEMPT, RUN_NUMBER, require_original_version
from publish import promote_stable


class ReleaseHistoryTests(unittest.TestCase):
    def setUp(self):
        build = Path("build")
        build.mkdir(exist_ok=True)
        scratch = TemporaryDirectory(dir=build)
        self.addCleanup(scratch.cleanup)
        self.repo = Path(scratch.name).resolve()
        self.git("init", "-q", "-b", "main")
        self.old = self.commit("v0.1.0")
        self.new = self.commit("v0.1.0")
        self.git("remote", "add", "origin", str(self.repo))
        self.history = {"GIT_DIR": str(self.repo / ".git"), "GIT_WORK_TREE": str(self.repo)}

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), "-c", "user.name=Fixture",
                                        "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
                                        *args], text=True).strip()

    def commit(self, version):
        directory = self.repo / "release"
        directory.mkdir(exist_ok=True)
        (directory / "version").write_text(version + "\n")
        self.git("add", "release/version")
        self.git("commit", "-q", "--allow-empty", "-m", "fixture")
        return self.git("rev-parse", "HEAD")

    def test_original_version_must_be_declared_by_a_reachable_source(self):
        with patch.dict(os.environ, self.history):
            require_original_version(self.old, self.new, "v0.1.0")
            with self.assertRaisesRegex(ValueError, "another release version"):
                require_original_version(self.old, self.new, "v0.1.1")
            with self.assertRaisesRegex(ValueError, "outside"):
                require_original_version(self.new, self.old, "v0.1.0")

    def test_dispatch_requires_the_current_remote_main_tip(self):
        script = str(Path(__file__).with_name("check-dispatch.sh").resolve())
        env = dict(os.environ, **self.history, GITHUB_EVENT_NAME="workflow_dispatch")
        for ref, sha, success in [("refs/heads/main", self.new, True), ("refs/heads/main", self.old, False),
                                  ("refs/heads/topic", self.new, False)]:
            with self.subTest(ref=ref, sha=sha):
                result = subprocess.run(["bash", script], env={**env, "GITHUB_REF": ref, "GITHUB_SHA": sha})
                self.assertEqual(result.returncode == 0, success)

    def try_promotion(self, source, number, attempt):
        old_index = "sha256:" + "a" * 64
        new_index = "sha256:" + "b" * 64
        release = {"index": new_index, "version_index": old_index, "version": "v0.1.0",
                   "build": "v0.1.0-b55-1", "source": source, "run_number": number, "run_attempt": attempt}
        stable = {"Config": {"Labels": {
            "org.opencontainers.image.version": release["version"], "org.opencontainers.image.revision": self.new,
            RUN_NUMBER: "5", RUN_ATTEMPT: "2",
        }}}
        with patch.dict(os.environ, self.history), \
                patch("publish.docker", side_effect=["", json.dumps([stable]), ""]) as docker, \
                patch("publish.inspect_digest", side_effect=[old_index, new_index, old_index, new_index]):
            promote_stable("example.invalid/project", release)
            self.assertEqual(docker.call_args.args[2], "create")

    def test_rerunning_an_older_commit_cannot_roll_back_stable(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            self.try_promotion(self.old, "6", "1")

    def test_same_source_rebuild_orders_by_run_and_attempt(self):
        for number, attempt in [("4", "9"), ("5", "1"), ("5", "2")]:
            with self.assertRaisesRegex(ValueError, "earlier build"):
                self.try_promotion(self.new, number, attempt)
        self.try_promotion(self.new, "5", "3")
        self.try_promotion(self.new, "6", "1")
