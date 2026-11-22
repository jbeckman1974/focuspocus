import contextlib
import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import cloud_image
import ownership
import tumbleweed as vm


class ProjectTest(unittest.TestCase):
    def setUp(self):
        build = vm.ROOT / "build"
        if build.is_symlink():
            self.fail("Tests require a project-local build directory")
        build.mkdir(exist_ok=True)
        project = tempfile.TemporaryDirectory(dir=build, prefix="vm-test-")
        self.addCleanup(project.cleanup)
        self.project = Path(project.name)
        messages = contextlib.redirect_stdout(io.StringIO())
        messages.__enter__()
        self.addCleanup(messages.__exit__, None, None, None)


class CloudImageTests(ProjectTest):
    contents = b"test image contents"
    digest = hashlib.sha256(contents).hexdigest()

    def test_checksum_binds_digest_to_exact_filename(self):
        for separator in ("  ", " *"):
            self.assertEqual(cloud_image.checksum(self.digest + separator + cloud_image.NAME), self.digest)
        for manifest in (self.digest, self.digest + "  different.qcow2", "abc  " + cloud_image.NAME,
                         self.digest + "  " + cloud_image.NAME + "\nextra"):
            with self.subTest(manifest=manifest), self.assertRaises(ValueError):
                cloud_image.checksum(manifest)

    def test_verified_image_is_cached_and_detects_disk_corruption(self):
        def download(args, *, check):
            self.assertTrue(check)
            self.assertEqual(args[args.index("--proto-redir") + 1], "=https")
            self.assertEqual(args[args.index("--max-time") + 1], "3600")
            self.assertEqual(args[args.index("--speed-time") + 1], "90")
            self.assertEqual(args[args.index("--max-filesize") + 1], str(cloud_image.MAX_IMAGE_BYTES))
            self.assertEqual(args[-1], cloud_image.URL)
            Path(args[args.index("--output") + 1]).write_bytes(self.contents)

        with patch("cloud_image.signed_checksum", return_value=self.digest), \
                patch("cloud_image.subprocess.run", side_effect=download) as fetch:
            image, digest = cloud_image.verified_image(self.project)
            self.assertEqual((image.read_bytes(), digest), (self.contents, self.digest))
            self.assertEqual(cloud_image.verified_image(self.project), (image, digest))
            self.assertEqual(fetch.call_count, 1)
            image.write_bytes(b"corrupt")
            cloud_image.verified_image(self.project)
            self.assertEqual(image.read_bytes(), self.contents)
            self.assertEqual(fetch.call_count, 2)

    def test_bad_transfer_never_promotes_disk(self):
        with patch("cloud_image.signed_checksum", return_value=self.digest), \
                patch("cloud_image.subprocess.run"), self.assertRaisesRegex(ValueError, "checksum mismatch"):
            cloud_image.verified_image(self.project)
        self.assertEqual(list(self.project.iterdir()), [])

    def test_publisher_signature_is_checked_before_using_the_manifest(self):
        status = ("[GNUPG:] VALIDSIG " + "A" * 40 + " 2026-11-20 1 0 4 0 1 10 00 "
                  + cloud_image.SIGNER + "\n")

        def download(url, path, seconds, max_bytes):
            self.assertLessEqual(seconds, 120)
            self.assertLessEqual(max_bytes, 128 * 1024)
            if url.endswith(".sha256"):
                path.write_text(self.digest + "  " + cloud_image.NAME + "\n")

        with patch("cloud_image.fetch", side_effect=download), patch("cloud_image.subprocess.run"), \
                patch("cloud_image.subprocess.check_output", return_value=status) as verify:
            self.assertEqual(cloud_image.signed_checksum(self.project), self.digest)
            command = verify.call_args.args[0]
            self.assertEqual(command[-3], "--verify")
            self.assertIn("--no-auto-key-retrieve", command)
            self.assertTrue(str(Path(command[-1]).parent).startswith(str(self.project) + os.sep))
        self.assertEqual(list(self.project.iterdir()), [])
        for invalid in ("", status.replace(cloud_image.SIGNER, "1" * 40), status + "[GNUPG:] EXPKEYSIG 1\n"):
            with self.subTest(status=invalid), self.assertRaises(ValueError):
                cloud_image.require_signer(invalid)

    def test_signature_failure_skips_disk_download(self):
        with patch("cloud_image.signed_checksum", side_effect=ValueError("signature")), \
                patch("cloud_image.fetch") as download, self.assertRaisesRegex(ValueError, "signature"):
            cloud_image.verified_image(self.project)
        download.assert_not_called()


class LifecycleTests(ProjectTest):
    def setUp(self):
        super().setUp()
        self.home = self.project / "build" / "vm" / "lima"
        self.directory = self.home / vm.INSTANCE
        self.status = "Stopped"
        self.calls = []
        self.fail_setup = False
        self.interrupt_create = False

    def lima(self, args, **kwargs):
        self.assertEqual(args[0], "limactl")
        self.assertEqual(kwargs["env"]["LIMA_HOME"], str(self.home))
        self.assertNotIn("SSH_AUTH_SOCK", kwargs["env"])
        self.assertNotIn("VM_TEST_PRIVATE", kwargs["env"])
        self.calls.append(args[1:])
        stdout = ""
        if args[1] == "create":
            self.assertIn("--name=" + vm.INSTANCE, args)
            config = kwargs["input"]
            for expected in ("arch: x86_64", "vmType: qemu", "plain: true", "loadDotSSHPubKeys: false",
                             "forwardAgent: false", "mounts: []", "digest: sha256:" + "a" * 64):
                self.assertIn(expected, config)
            self.directory.mkdir()
            (self.directory / "lima.yaml").write_text(config)
            if self.interrupt_create:
                raise subprocess.CalledProcessError(1, args)
        elif args[1] == "list":
            stdout = self.status + "\n"
        elif args[1] == "start":
            self.status = "Running"
        elif args[1] == "stop":
            self.status = "Stopped"
        elif args[1] == "delete":
            self.assertEqual(args[-1], vm.INSTANCE)
            (self.directory / "lima.yaml").unlink()
            self.directory.rmdir()
        elif args[1] == "shell":
            self.assertIn("--workdir=/", args)
            self.assertIn("--start=false", args)
            if args[-1] in {"setup", "verify"}:
                self.assertEqual(args[-5:-1], ["-n", "sh", "-s", "--"])
                self.assertIn("docker compose version", kwargs["input"])
                if self.fail_setup:
                    raise subprocess.CalledProcessError(1, args)
                if args[-1] == "verify":
                    stdout = "Guest: openSUSE Tumbleweed (snapshot 20261120), kernel fixture x86_64, Docker linux/amd64\n"
        return subprocess.CompletedProcess(args, 0, stdout)

    def test_lifecycle_scopes_all_commands_and_preserves_other_instances(self):
        with patch("tumbleweed.prerequisites"), patch("tumbleweed.subprocess.run", side_effect=self.lima), \
                patch("tumbleweed.verified_image", return_value=(self.project / 'an "image"', "a" * 64)) as fetch, \
                patch.dict(os.environ, {"LIMA_HOME": "/ignored", "VM_TEST_PRIVATE": "sentinel"}):
            for action in ("up", "up", "verify", "shell"):
                vm.manage(action, self.project)
            other = self.home / "different"
            other.mkdir()
            for action in ("stop", "stop", "up", "destroy"):
                vm.manage(action, self.project)
        self.assertTrue(other.is_dir())
        self.assertFalse(self.directory.exists())
        self.assertFalse((self.home.parent / ownership.RECORD).exists())
        evidence = (self.home.parent / "last-verification.txt").read_text()
        self.assertIn("snapshot 20261120", evidence)
        self.assertIn("kernel fixture x86_64", evidence)
        commands = [call[0] for call in self.calls]
        self.assertEqual(commands.count("create"), 1)
        self.assertEqual(commands.count("start"), 2)
        self.assertEqual(commands.count("stop"), 2)
        self.assertEqual(commands[-1], "delete")
        fetch.assert_called_once()

    def test_retry_after_guest_setup_failure_reuses_existing_instance(self):
        self.fail_setup = True
        with patch("tumbleweed.prerequisites"), patch("tumbleweed.subprocess.run", side_effect=self.lima), \
                patch("tumbleweed.verified_image", return_value=(self.project / "disk", "a" * 64)) as fetch:
            with self.assertRaises(subprocess.CalledProcessError):
                vm.manage("up", self.project)
            self.fail_setup = False
            vm.manage("up", self.project)
        fetch.assert_called_once()
        self.assertEqual([args[0] for args in self.calls].count("create"), 1)

    def test_foreign_same_name_is_preserved_with_no_lima_commands(self):
        self.directory.mkdir(parents=True)
        config = self.directory / "lima.yaml"
        config.write_text("arch: x86_64\n")
        with patch("tumbleweed.prerequisites"), patch("tumbleweed.subprocess.run") as run, \
                patch("tumbleweed.verified_image") as fetch:
            for with_record in (False, True):
                if with_record:
                    ownership.reserve(self.home.parent)
                for action in ("up", "status", "shell", "verify", "stop", "destroy"):
                    with self.subTest(action=action, with_record=with_record), self.assertRaises(ValueError):
                        vm.manage(action, self.project)
        run.assert_not_called()
        fetch.assert_not_called()
        self.assertEqual(config.read_text(), "arch: x86_64\n")

    def test_interrupted_create_recovers_using_instance_identity(self):
        self.interrupt_create = True
        with patch("tumbleweed.prerequisites"), patch("tumbleweed.subprocess.run", side_effect=self.lima), \
                patch("tumbleweed.verified_image", return_value=(self.project / "disk", "a" * 64)) as fetch:
            with self.assertRaises(subprocess.CalledProcessError):
                vm.manage("up", self.project)
            self.interrupt_create = False
            vm.manage("up", self.project)
        fetch.assert_called_once()
        self.assertEqual([args[0] for args in self.calls].count("create"), 1)

    def test_incomplete_instance_without_matching_config_is_preserved(self):
        self.directory.mkdir(parents=True)
        ownership.reserve(self.home.parent)
        with patch("tumbleweed.prerequisites"), patch("tumbleweed.subprocess.run") as run:
            for action in ("up", "destroy"):
                with self.assertRaisesRegex(ValueError, "verify the instance configuration"):
                    vm.manage(action, self.project)
        run.assert_not_called()
        self.assertTrue(self.directory.exists())

    def test_absent_instance_is_read_only(self):
        with patch("tumbleweed.subprocess.run") as run, contextlib.redirect_stdout(io.StringIO()):
            for action in ("stop", "status", "destroy"):
                vm.manage(action, self.project)
            for action in ("verify", "shell"):
                with self.assertRaisesRegex(ValueError, "absent"):
                    vm.manage(action, self.project)
        run.assert_not_called()
        self.assertEqual(list(self.project.iterdir()), [])

    def test_redirected_build_path_is_refused(self):
        elsewhere = self.project / "elsewhere"
        elsewhere.mkdir()
        (self.project / "build").symlink_to(elsewhere, target_is_directory=True)
        with patch("tumbleweed.prerequisites"), self.assertRaisesRegex(ValueError, "symbolic link"):
            vm.manage("up", self.project)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_doctor_reports_missing_tools_without_creating_state(self):
        with patch("tumbleweed.shutil.which", return_value=None), self.assertRaisesRegex(ValueError, "qemu"):
            vm.manage("doctor", self.project)
        self.assertEqual(list(self.project.iterdir()), [])

    @unittest.skipUnless(shutil.which("limactl"), "limactl is required for real schema validation")
    def test_template_with_lima_validator(self):
        disk = self.project / "base image.qcow2"
        disk.touch()
        config = self.project / "test.yaml"
        config.write_text(vm.template(disk, cloud_image.sha256(disk), "fp-" + "a" * 32))
        env = {**os.environ, "LIMA_HOME": str(self.project / "lima"), "TMPDIR": str(self.project)}
        subprocess.run(["limactl", "template", "validate", str(config)], env=env, check=True)


class GuestReportTests(ProjectTest):
    def test_guest_checks_snapshot_kernel_platform_and_ssh_settings(self):
        # Supply the Linux release file and daemon commands inside this Mac-side fixture.
        # The original verify control flow, settings, platform checks and printf calls execute in sh.
        release = self.project / "os-release"
        release.write_text('ID=opensuse-tumbleweed\nPRETTY_NAME="Test Tumbleweed"\nVERSION_ID=20990101\n')
        source = (vm.SOURCE / "guest.sh").read_text()
        source = source.replace(". /etc/os-release", '. "$FIXTURE_RELEASE"').replace("/usr/sbin/sshd", "fixture_sshd")
        commands = """
uname() { case "$1" in -r) echo 6.0.fixt ;; -m) echo x86_64 ;; *) return 1 ;; esac; }
systemctl() { [ "$*" = 'is-active --quiet docker.service' ]; }
fixture_sshd() {
    printf '%s\\n' 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' \
        'authenticationmethods publickey' "allowusers $SUDO_USER"
}
docker() {
    case "$*" in
        'version --format {{.Server.Os}}/{{.Server.Arch}}') echo "linux/$FIXTURE_ARCH" ;;
        'version --format Docker Engine {{.Server.Version}}') echo 'Docker Engine fixture-engine' ;;
        'compose version') echo 'Docker Compose fixture-plugin' ;;
        *) return 1 ;;
    esac
}
"""
        def verify(arch):
            env = {"PATH": os.defpath, "SUDO_USER": "fixture", "FIXTURE_RELEASE": str(release), "FIXTURE_ARCH": arch}
            return subprocess.run(["sh", "-s", "--", "verify"], text=True, input=commands + source,
                                  env=env, capture_output=True)

        passed = verify("amd64")
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertIn("snapshot 20990101", passed.stdout)
        self.assertIn("kernel 6.0.fixt x86_64, Docker linux/amd64", passed.stdout)
        self.assertIn("Docker Compose fixture-plugin", passed.stdout)
        failed = verify("arm64")
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("Expected Docker linux/amd64, found linux/arm64", failed.stderr)


if __name__ == "__main__":
    unittest.main()
