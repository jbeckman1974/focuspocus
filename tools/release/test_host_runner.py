"""Exercise host cleanup and network restrictions without a running Docker daemon."""

import importlib.util
import fcntl
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


def load_ops(name):
    path = Path(__file__).resolve().parents[2] / "ops" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    with patch.object(sys, "path", [str(path.parent), *sys.path]):
        spec.loader.exec_module(module)
    return module


runner = load_ops("test-host")
network = load_ops("check-test-network")


class HostImagesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.run_id = "a" * 32
        self.record = Path(temp.name) / f"{self.run_id}.images"
        self.record.touch()
        self.tags = {target: runner.image_tag(self.run_id, target) for target in runner.TARGETS}

    def test_selectively_removes_owned_tags_and_keeps_in_use_image(self):
        ids = {self.tags["application"]: "app-id", self.tags["browser-tests"]: "browser-id"}

        def inspect(*args):
            if args[1:3] == ("image", "inspect"):
                return self.run_id
            self.assertEqual(args[:4], ("docker", "ps", "-aq", "--filter"))
            return "container" if args[4] == "ancestor=browser-id" else ""

        with patch.object(runner, "tagged_id", side_effect=ids.get), patch.object(runner, "output", side_effect=inspect):
            with patch.object(runner.subprocess, "run") as remove:
                runner.cleanup(self.record)
                remove.assert_called_once_with(["docker", "image", "rm", "--no-prune", self.tags["application"]], check=True)
        self.assertTrue(self.record.exists())

    def test_retains_reassigned_tag_and_retires_empty_record(self):
        found = {self.tags["application"]: "new-id"}
        with patch.object(runner, "tagged_id", side_effect=found.get), patch.object(runner, "output", return_value="foreign"):
            with patch.object(runner.subprocess, "run") as remove:
                runner.cleanup(self.record)
                self.assertTrue(self.record.exists())
                found.clear()
                runner.cleanup(self.record)
                remove.assert_not_called()
        self.assertFalse(self.record.exists())

    def test_changed_image_is_never_removed(self):
        with patch.object(runner, "tagged_id", side_effect=["before", "after"]), patch.object(runner, "output", side_effect=[self.run_id, ""]):
            with patch.object(runner.subprocess, "run") as remove, self.assertRaisesRegex(RuntimeError, "changed"):
                runner.cleanup(self.record)
            remove.assert_not_called()

    def test_second_build_failure_still_cleans_recorded_app_image(self):
        self.record.unlink()
        failure = subprocess.CalledProcessError(1, ["docker", "build"])
        with patch.object(runner, "tagged_id", side_effect=["", "", "", "app", "app", "", ""]):
            with patch.object(runner, "output", side_effect=[self.run_id, ""]):
                with patch.object(runner.subprocess, "run", side_effect=[None, failure, None]) as command:
                    with self.assertRaises(subprocess.CalledProcessError):
                        runner.verify("c" * 40, self.record, 7, "d" * 32)
                    self.assertEqual(command.call_args_list[0].kwargs["pass_fds"], (7,))
                    self.assertEqual(command.call_args.args[0], ["docker", "image", "rm", "--no-prune", self.tags["application"]])
        self.assertFalse(self.record.exists())

    def test_all_host_suites_allocate_their_databases_under_verified_sibling_storage(self):
        self.record.unlink()
        with patch.object(runner, "tagged_id", return_value=""), patch.object(runner.subprocess, "run") as execute:
            runner.verify("c" * 40, self.record, 7, "d" * 32)
        checks = [call for call in execute.call_args_list if call.args[0][:3] == ("python3", "-B", "ops/host_test_data.py")]
        self.assertEqual([call.args[0][3:] for call in checks], [(), ("--performance",), ("--accessibility",), ("--pg-upgrade",)])
        for call in checks:
            self.assertEqual(call.kwargs["env"]["FOCUSPOCUS_IMAGE"], self.tags["application"])
            self.assertEqual(call.kwargs["env"]["FOCUSPOCUS_HOST_RECOVERY_ATTEMPT"], "d" * 32)
            self.assertEqual(call.kwargs["env"]["FOCUSPOCUS_ACCESSIBILITY_IMAGE"], self.tags["accessibility-tests"])
            self.assertEqual(call.kwargs["pass_fds"], (7,))

    def test_tag_collision_stops_before_building_or_registering(self):
        self.record.unlink()
        with patch.object(runner, "tagged_id", return_value="other"), patch.object(runner.subprocess, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                runner.verify("c" * 40, self.record, 7, "d" * 32)
            command.assert_not_called()
        self.assertFalse(self.record.exists())

    def test_same_revision_retry_retires_the_old_report_under_lock_before_building(self):
        build = self.record.parent / "build"
        build.mkdir()
        state = build / "test-host"
        revision = "c" * 40
        previous = runner.recovery_report.begin_attempt(build)
        current = runner.recovery_report.publish(build, {"source_revision": revision, "result": "passed"}, previous)
        prior_bytes = current.read_bytes()

        def interrupted(sha, record, lock_fd, attempt):
            self.assertEqual(sha, revision)
            self.assertFalse(current.exists())
            self.assertNotEqual(attempt, previous)
            with (state / "lock").open("r") as other, self.assertRaises(BlockingIOError):
                fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            raise InterruptedError("simulated build interruption")

        with patch.object(runner, "check_host"), patch.object(runner, "Path", return_value=state):
            with patch.object(runner, "verify", side_effect=interrupted), self.assertRaises(InterruptedError):
                runner.main(revision)
        self.assertFalse(current.exists())
        backups = list(current.parent.glob("previous-*/report.json"))
        self.assertEqual([backup.read_bytes() for backup in backups], [prior_bytes])
        self.assertEqual(backups[0].parent.stat().st_mode & 0o777, 0o700)


class HostNetworkTests(unittest.TestCase):
    def setUp(self):
        name = "focuspocus-qa-stack-ab123"
        self.model = {
            "name": name,
            "networks": {"database": {"name": name + "_database", "internal": True}, "web": {"name": name + "_web"}},
            "volumes": {"pgdata": {"name": name + "_pgdata"}},
            "services": {
                "db": {"networks": {"database": None}},
                "web": {"networks": {"database": None, "web": None}, "ports": [{"target": 8000, "host_ip": "127.0.0.1"}]},
            },
        }

    def test_loopback_only_and_dedicated_networks(self):
        network.validate(self.model)
        self.model["services"]["web"]["ports"][0]["host_ip"] = "0.0.0.0"
        with self.assertRaisesRegex(ValueError, "loopback"):
            network.validate(self.model)

    def test_database_port_and_host_network_rejected(self):
        self.model["services"]["db"]["ports"] = [{"target": 5432}]
        with self.assertRaisesRegex(ValueError, "publish"):
            network.validate(self.model)
        del self.model["services"]["db"]["ports"]
        self.model["services"]["web"]["network_mode"] = "host"
        with self.assertRaisesRegex(ValueError, "network"):
            network.validate(self.model)

    def test_proxy_or_shared_network_is_rejected(self):
        for key, value in (("external", True), ("name", "proxy")):
            with self.subTest(key=key), patch.dict(self.model["networks"]["web"], {key: value}):
                with self.assertRaisesRegex(ValueError, "belong"):
                    network.validate(self.model)

    def test_foreign_data_volume_is_rejected(self):
        self.model["volumes"]["pgdata"]["name"] = "existing-data"
        with self.assertRaisesRegex(ValueError, "volumes must belong"):
            network.validate(self.model)
