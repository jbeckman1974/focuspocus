import hashlib
import json
import socket
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock
from urllib.error import URLError

from archive import PROJECT, inventory, locked_archive
from catalog import Source, read_catalog
from transport import Page


GUIDE = Source("guide", "Guide & recipes", "https://docs.example.invalid/guide")


def page(source=GUIDE, data=b"<html>First edition</html>"):
    return Page(data, source.url, "text/html")


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        build = PROJECT / "build"
        self.assertFalse(build.is_symlink())
        build.mkdir(exist_ok=True)
        scratch = tempfile.TemporaryDirectory(prefix="reference-test-", dir=build)
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name) / "OmniFocus"

    def records(self):
        return json.loads((self.root / "manifest.json").read_text(encoding="utf-8"))["sources"]

    def index(self):
        return (self.root / "index.html").read_text(encoding="utf-8")

    def test_first_fetch_saves_source_bytes_provenance_and_index(self):
        self.root.mkdir()
        note = self.root / "my-note.txt"
        note.write_text("keep this", encoding="utf-8")
        original = page(data="<html>Uno · dos</html>".encode("utf-8"))
        fetch = Mock(return_value=original)
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 0)
        record = self.records()[GUIDE.id]
        capture, = record["captures"]
        digest = hashlib.sha256(original.data).hexdigest()
        self.assertEqual(capture["file"], f"copies/guide-{digest}.html")
        self.assertEqual((self.root / capture["file"]).read_bytes(), original.data)
        self.assertEqual(capture["bytes"], len(original.data))
        self.assertEqual(capture["sha256"], digest)
        self.assertEqual(capture["content_type"], "text/html")
        self.assertEqual(capture["requested_url"], GUIDE.url)
        self.assertEqual(capture["resolved_url"], original.resolved_url)
        self.assertEqual(datetime.fromisoformat(capture["captured_utc"]).utcoffset().total_seconds(), 0)
        self.assertIn(capture["file"], self.index())
        self.assertIn("Guide &amp; recipes", self.index())
        self.assertEqual(note.read_text(encoding="utf-8"), "keep this")

    def test_index_links_to_separate_upstream_collection_when_available(self):
        self.assertEqual(inventory(self.root, [GUIDE], page), 0)
        self.assertNotIn('href="upstream/index.html"', self.index())
        upstream = self.root / "upstream"
        upstream.mkdir()
        (upstream / "index.html").write_text("Other local documentation", encoding="utf-8")
        self.assertEqual(inventory(self.root, [GUIDE], page), 0)
        self.assertIn('href="upstream/index.html"', self.index())

    def test_cached_copy_and_retried_refresh_retain_each_edition(self):
        first, second = page(), page(data=b"<html>Second edition</html>")
        fetch = Mock(side_effect=[first, second, second, TimeoutError("publisher timeout")])
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 0)
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 0)
        self.assertEqual(self.records()[GUIDE.id]["status"], "Verified local copy")
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(inventory(self.root, [GUIDE], fetch, refresh=True), 0)
        self.assertEqual(inventory(self.root, [GUIDE], fetch, refresh=True), 0)
        self.assertEqual(inventory(self.root, [GUIDE], fetch, refresh=True), 1)
        record = self.records()[GUIDE.id]
        self.assertIn("previous copy verified", record["status"])
        self.assertIn("publisher timeout", self.index())
        self.assertEqual(len(record["captures"]), 2)
        for capture, original in zip(record["captures"], (first, second)):
            self.assertEqual((self.root / capture["file"]).read_bytes(), original.data)
            self.assertIn(capture["file"], self.index())

    def test_edited_copy_is_preserved_and_hidden_from_local_links(self):
        self.assertEqual(inventory(self.root, [GUIDE], page), 0)
        capture, = self.records()[GUIDE.id]["captures"]
        path = self.root / capture["file"]
        changed = b"x" * capture["bytes"]
        path.write_bytes(changed)
        fetch = Mock()
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 1)
        fetch.assert_not_called()
        self.assertEqual(path.read_bytes(), changed)
        self.assertEqual(self.records()[GUIDE.id]["status"], "Unavailable")
        self.assertNotIn(f'href="{capture["file"]}"', self.index())

    def test_missing_copy_recovers_from_publisher(self):
        fetch = Mock(side_effect=page)
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 0)
        capture, = self.records()[GUIDE.id]["captures"]
        path = self.root / capture["file"]
        path.unlink()
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 0)
        self.assertEqual(path.read_bytes(), page().data)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(len(self.records()[GUIDE.id]["captures"]), 1)

    def test_unavailable_source_has_no_capture_and_can_be_retried(self):
        fetch = Mock(side_effect=[TimeoutError("read timed out"), page()])
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 1)
        self.assertEqual(self.records()[GUIDE.id]["captures"], [])
        self.assertEqual(list((self.root / "copies").iterdir()), [])
        self.assertIn(GUIDE.url, self.index())
        self.assertIn("read timed out", self.index())
        self.assertEqual(inventory(self.root, [GUIDE], fetch), 0)
        self.assertEqual(len(self.records()[GUIDE.id]["captures"]), 1)

    def test_dns_failure_skips_only_that_host_for_one_run(self):
        same_host = Source("appendix", "Appendix", "https://docs.example.invalid/appendix")
        other_host = Source("manual", "Manual", "https://other.example.invalid/")
        sources = [GUIDE, same_host, other_host]
        fetch = Mock(side_effect=[URLError(socket.gaierror("offline")), page(other_host)])
        self.assertEqual(inventory(self.root, sources, fetch), 2)
        self.assertEqual([call.args[0] for call in fetch.call_args_list], [GUIDE, other_host])
        records = self.records()
        self.assertEqual(records[same_host.id]["captures"], [])
        self.assertEqual(records[other_host.id]["status"], "Downloaded")

    def test_unmanaged_reserved_file_and_linked_output_are_protected(self):
        self.root.mkdir()
        existing = self.root / "index.html"
        existing.write_text("my own index", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unmanaged"):
            inventory(self.root, [GUIDE], page)
        self.assertEqual(existing.read_text(encoding="utf-8"), "my own index")
        link = self.root.parent / "linked-archive"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "real project directory"):
            inventory(link, [GUIDE], page)

    def test_linked_cached_file_is_never_followed_or_replaced(self):
        self.assertEqual(inventory(self.root, [GUIDE], page), 0)
        capture, = self.records()[GUIDE.id]["captures"]
        path = self.root / capture["file"]
        other = self.root.parent / "other.html"
        path.rename(other)
        path.symlink_to(other)
        self.assertEqual(inventory(self.root, [GUIDE], page, refresh=True), 1)
        self.assertTrue(path.is_symlink())
        self.assertEqual(other.read_bytes(), page().data)
        self.assertNotIn(f'href="{capture["file"]}"', self.index())

    def test_active_run_excludes_second_writer(self):
        with locked_archive(self.root):
            with self.assertRaisesRegex(ValueError, "in progress"):
                inventory(self.root, [GUIDE], page)
        self.assertEqual(inventory(self.root, [GUIDE], page), 0)

    def test_release_capture_requires_the_mac_entry_and_its_date(self):
        release = next(source for source in read_catalog() if source.id == "omnifocus-release-notes")
        wrong_edition = b"<h2>OmniFocus for iOS 4.10.1</h2><h3>November 10, 2026</h3>"
        right_edition = b"<h2>OmniFocus for <b>Mac</b> 4.10.1</h2><h3>November 10, 2026</h3>"
        fetch = Mock(side_effect=[page(release, wrong_edition), page(release, right_edition)])
        self.assertEqual(inventory(self.root, [release], fetch), 1)
        self.assertEqual(self.records()[release.id]["captures"], [])
        self.assertEqual(inventory(self.root, [release], fetch), 0)
        self.assertEqual(len(self.records()[release.id]["captures"]), 1)
