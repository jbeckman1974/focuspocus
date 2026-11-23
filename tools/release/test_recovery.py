"""Use real authenticated encryption to exercise publication, corruption and failure paths."""

from pathlib import Path
from concurrent.futures import Future
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ops/recovery"))
import concurrent_migrations
from drill import generate_recipient
from envelope import checksum, seal, unseal
import report


class RecoveryEnvelopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path("build")
        root.mkdir(exist_ok=True)
        cls.scope = tempfile.TemporaryDirectory(prefix="qa-recovery-envelope.", dir=root)
        cls.addClassCleanup(cls.scope.cleanup)
        cls.root = Path(cls.scope.name)
        cls.cert, cls.key = cls.root / "cert.pem", cls.root / "key.pem"
        generate_recipient(cls.cert, cls.key)

    def setUp(self):
        scope = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(scope.cleanup)
        self.run_dir = Path(scope.name)
        self.source = self.run_dir / "fixture"
        self.source.write_bytes(bytes(range(256)) * 100)
        self.archive = self.run_dir / "sealed.cms"
        self.clear = self.run_dir / "verified.dump"
        self.digest = seal(self.cert, self.archive, ["cat", str(self.source)])

    def test_round_trip_and_existing_outputs(self):
        self.assertNotIn(self.source.read_bytes()[:256], self.archive.read_bytes())
        unseal(self.cert, self.key, self.archive, self.digest, self.clear)
        self.assertEqual(self.clear.read_bytes(), self.source.read_bytes())
        for path in (self.archive, self.clear):
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            seal(self.cert, self.archive, ["cat", str(self.source)])
        self.clear.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            unseal(self.cert, self.key, self.archive, self.digest, self.clear)
        self.assertEqual(self.clear.read_bytes(), b"existing")

    def test_tamper_rejected_before_cleartext_is_published(self):
        modified = bytearray(self.archive.read_bytes())
        modified[len(modified) // 2] ^= 1
        self.archive.write_bytes(modified)
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            unseal(self.cert, self.key, self.archive, self.digest, self.clear)
        # Even when supplied with the checksum of corrupted bytes, CMS must reject the altered payload.
        with self.archive.open("rb") as source:
            damaged_digest = checksum(source)
        with self.assertRaises(subprocess.CalledProcessError):
            unseal(self.cert, self.key, self.archive, damaged_digest, self.clear)
        self.assertEqual(set(self.run_dir.iterdir()), {self.archive, self.source})

    def test_failed_dump_does_not_publish_partial_output(self):
        output = self.run_dir / "incomplete.cms"
        with self.assertRaisesRegex(RuntimeError, "producer failed"):
            seal(self.cert, output, [sys.executable, "-c", "print('incomplete dump'); raise SystemExit(1)"])
        self.assertFalse(output.exists())

    def test_output_parent_must_be_private(self):
        self.run_dir.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "private output directory"):
            unseal(self.cert, self.key, self.archive, self.digest, self.clear)
        self.assertFalse(self.clear.exists())


class RecoveryReportTests(unittest.TestCase):
    revision = "a" * 40
    image = "sha256:" + "b" * 64

    def setUp(self):
        self.ci = {"GITHUB_ACTIONS": "true", "GITHUB_SERVER_URL": "https://github.com",
                   "GITHUB_REPOSITORY": "example/project", "GITHUB_RUN_ID": "19",
                   "GITHUB_RUN_ATTEMPT": "2", "FOCUSPOCUS_CI_JOB_ID": "37", "GITHUB_SHA": self.revision}
        self.snapshot = {key: 17 for key in report.SIZES}
        self.snapshot["immutable"] = "private-fixture-marker"
        self.inputs = dict(environment=self.ci, revision=self.revision, architecture="amd64", image_id=self.image,
                           snapshot=self.snapshot, archive_sha256="c" * 64, archive_bytes=42, rpo=2.51, rto=3.14)

    def test_sanitized_native_report_is_linked_to_exact_image_and_job(self):
        evidence = report.summary(**self.inputs)
        self.assertEqual((evidence["source_revision"], evidence["image_id"]), (self.revision, self.image))
        self.assertEqual(evidence["ci_job_url"], "https://github.com/example/project/actions/runs/19/job/37")
        self.assertEqual(evidence["ci_run_attempt"], 2)
        self.assertEqual(evidence["validated_rto_seconds"], 3.14)
        self.assertTrue(evidence["revoked_membership_reconciled"] and evidence["concurrent_migrators_serialized"])
        with tempfile.TemporaryDirectory() as folder:
            build = Path(folder)
            attempt = report.begin_attempt(build)
            destination = report.publish(build, evidence, attempt)
            self.assertEqual(destination.relative_to(folder).as_posix(), "recovery/report.json")
            self.assertNotIn("private-fixture-marker", destination.read_text())
            self.assertEqual(json.loads(destination.read_text()), {**evidence, "recovery_attempt": attempt})
            report.verify_current(build, attempt)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_wrong_revision_missing_job_or_missed_objective_cannot_produce_a_passing_report(self):
        for override, error in [
            ({"revision": "f" * 40}, ValueError), ({"revision": ""}, ValueError),
            ({"environment": {**self.ci, "FOCUSPOCUS_CI_JOB_ID": ""}}, ValueError),
            ({"rto": 14400.1}, RuntimeError), ({"rpo": 86400.1}, RuntimeError),
            ({"snapshot": {**self.snapshot, "actions": "private"}}, ValueError),
        ]:
            with self.subTest(override=list(override)), self.assertRaises(error):
                report.summary(**{**self.inputs, **override})

    def test_local_unlabeled_image_and_non_following_artifact_paths(self):
        evidence = report.summary(**{**self.inputs, "environment": {}, "revision": ""})
        self.assertIsNone(evidence["source_revision"])
        self.assertIsNone(evidence["ci_job_url"])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "recovery").symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                report.begin_attempt(root)

    def test_standalone_retry_interrupted_before_stack_setup_preserves_the_prior_report(self):
        with tempfile.TemporaryDirectory() as folder:
            checkout = Path(folder)
            build = checkout / "build"
            build.mkdir()
            first = report.begin_attempt(build)
            prior = report.summary(**self.inputs)
            current = report.publish(build, prior, first)
            contents = current.read_bytes()
            self.assertEqual(report.begin_attempt(build, inherited=first), first)
            self.assertEqual(current.read_bytes(), contents)
            scripts = checkout / "ops/recovery"
            scripts.mkdir(parents=True)
            shutil.copyfile(report.__file__, scripts / "report.py")
            (scripts.parent / "db-init.sh").touch()
            stop = checkout / "mktemp"
            stop.write_text("#!/bin/sh\nexit 23\n")
            stop.chmod(0o700)
            env = {**os.environ, "FOCUSPOCUS_IMAGE": "candidate", "EXPECTED_ARCH": "amd64",
                   "PATH": str(checkout) + os.pathsep + os.environ["PATH"]}
            env.pop("FOCUSPOCUS_HOST_RECOVERY_ATTEMPT", None)
            verifier = Path(__file__).resolve().parents[2] / "ops/verify-stack.sh"
            result = subprocess.run(["bash", str(verifier)], cwd=checkout, env=env, capture_output=True)
            self.assertEqual(result.returncode, 23, result.stderr)
            self.assertFalse(current.exists())
            self.assertEqual([p.read_bytes() for p in current.parent.glob("previous-*/report.json")], [contents])
            with self.assertRaisesRegex(ValueError, "newer invocation"):
                report.begin_attempt(build, inherited=first)
            with self.assertRaisesRegex(ValueError, "newer invocation"):
                report.publish(build, prior, first)
            self.assertFalse(current.exists())

    def test_symlinked_report_or_attempt_marker_leaves_its_target_intact(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            build = base / "build"
            build.mkdir()
            sentinel = base / "unrelated"
            sentinel.write_text("retain me")
            for name in ("report.json", ".attempt"):
                with self.subTest(name=name):
                    attempt = report.begin_attempt(build)
                    path = build / "recovery" / name
                    path.unlink(missing_ok=True)
                    path.symlink_to(sentinel)
                    with self.assertRaisesRegex(ValueError, "regular files"):
                        report.begin_attempt(build)
                    with self.assertRaisesRegex(ValueError, "regular files"):
                        report.publish(build, {}, attempt)
                    self.assertEqual(sentinel.read_text(), "retain me")
                    path.unlink()


class MigrationContentionTests(unittest.TestCase):
    def test_finished_process_cannot_count_as_an_overlap(self):
        process = Future()
        process.set_result(None)
        with patch.object(concurrent_migrations, "sql", return_value="f"):
            with self.assertRaisesRegex(RuntimeError, "finished before"):
                concurrent_migrations.wait_for(None, concurrent_migrations.CONTENTION, "overlap", [process])

    def test_requires_database_observation_even_when_both_processes_are_running(self):
        with patch.object(concurrent_migrations, "sql", side_effect=["f", "t"]) as query:
            with patch.object(concurrent_migrations.time, "sleep"):
                concurrent_migrations.wait_for(None, concurrent_migrations.CONTENTION, "overlap", [Future(), Future()])
        self.assertEqual(query.call_count, 2)
