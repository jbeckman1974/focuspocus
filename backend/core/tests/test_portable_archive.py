from datetime import datetime, timezone
from io import BytesIO
import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from core.portability import archive


class PortableWireTests(TestCase):
    def setUp(self):
        bound = patch.object(archive, "limit", return_value=8 * 1024 ** 2)
        bound.start()
        self.addCleanup(bound.stop)
        self.space = SimpleNamespace(pk=uuid4(), revision=7)

    def fixture(self):
        raw = b"bench\n"
        record = {"items": [{"id": self.space.pk, "stamp": datetime(2026, 11, 22, 7, 5, 0, 123456, tzinfo=timezone.utc)}]}
        return archive.write_bundle(self.space, record, [(archive.digest(raw), len(raw), raw)])

    def test_zip_contains_exact_unicode_bytes_checksums_and_full_clock_precision(self):
        with self.fixture() as file:
            directory, records = archive.open_bundle(file)
            with directory:
                self.assertEqual(records["items"][0]["stamp"], "2026-11-22T07:05:00.123456+00:00")
                self.assertEqual(directory.read("files/" + archive.digest(b"bench\n")), b"bench\n")
                manifest = json.loads(directory.read("manifest.json"))
                self.assertEqual(manifest["counts"], {"items": 1})
                self.assertEqual(manifest["workspaceId"], str(self.space.pk))
                self.assertEqual(manifest["revision"], 7)

    def test_changed_record_bytes_rejected_even_if_the_zip_crc_is_correct(self):
        modified = BytesIO()
        with self.fixture() as file, ZipFile(file) as source, ZipFile(modified, "w") as destination:
            for path in source.namelist():
                data = source.read(path) if path != "records.json" else b'{"items":[]}'
                destination.writestr(path, data)
        with self.assertRaises(ValueError):
            archive.open_bundle(modified)

    def test_reads_verified_version_one_records_as_unstarted_items(self):
        with patch.object(archive, "VERSION", 1):
            legacy = self.fixture()
        with legacy:
            directory, records = archive.open_bundle(legacy)
            with directory:
                self.assertIs(records["items"][0]["in_progress"], False)
                self.assertNotIn(b"in_progress", directory.read("records.json"))

    def test_rejects_compressed_content_before_decompressing(self):
        packed = BytesIO()
        with ZipFile(packed, "w", compression=ZIP_DEFLATED) as zipper:
            zipper.writestr("manifest.json", "{}")
            zipper.writestr("records.json", "A" * 500_000)
        with self.assertRaises(ValueError):
            archive.open_bundle(packed)

    def test_unexpected_file_count_and_trailing_data_rejected_before_directory_allocation(self):
        with self.fixture() as file:
            original = file.read()
        damaged = bytearray(original)
        damaged[-12:-10] = b'\xff\xff'
        for data in (damaged, original + b"extra"):
            with self.subTest(length=len(data)), self.assertRaises(ValueError):
                archive.open_bundle(BytesIO(data))

    def test_duplicate_or_nonfinite_json_values_rejected(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":-Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                archive._json(raw)
