"""Use real authenticated encryption to exercise publication, corruption and failure paths."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ops/recovery"))
from drill import generate_recipient
from envelope import checksum, seal, unseal


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
