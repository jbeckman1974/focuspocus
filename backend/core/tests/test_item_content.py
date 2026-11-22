import base64
import hashlib
from uuid import uuid4
from datetime import timedelta

from django.utils import timezone

from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings

from core.content.models import AttachmentBlob, AttachmentBody, AttachmentLink, ItemNote
from core.models import Item, Membership, Receipt

from .outline_case import OutlineApiMixin


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
NOTE = {"paragraphs": [[{"text": "Café", "bold": True}], [
    {"text": "Bench, β", "italic": True, "link": "https://example.invalid/bench"},
]]}


class FileApiMixin(OutlineApiMixin):
    def upload_headers(self, item, raw, filename="bench.txt", **updates):
        self.space.refresh_from_db()
        return {
            "X-File-Id": str(uuid4()), "X-Operation-Id": str(uuid4()), "X-Write-Context": self.context,
            "X-Item-Version": str(Item.objects.get(pk=item).version), "X-Workspace-Revision": str(self.space.revision),
            "X-File-Name": filename, "X-File-Sha256": hashlib.sha256(raw).hexdigest(),
            "X-File-Type": "text/plain", **updates,
        }

    def upload(self, item, raw, headers):
        return self.client.post(self.base + f"content/items/{item}/files", raw,
                                content_type="application/octet-stream", headers=headers)

    def metadata(self, item):
        return self.client.get(self.base + f"content/items/{item}")

    def download(self, item, link, mode="download"):
        return self.client.get(self.base + f"content/items/{item}/files/{link}/{mode}")

    def version(self, item):
        return Item.objects.get(pk=item).version

    def set_note(self, item, document, status=200):
        return self.command("set-note", {"id": item, "itemVersion": self.version(item), "document": document}, status)


class PrivateContentTests(FileApiMixin, TestCase):
    def test_rich_note_round_trip_plain_projection_invalid_formats_and_undo(self):
        item = self.capture(["A13"])[0]
        receipt = self.set_note(item, NOTE)
        self.assertEqual(self.metadata(item).json()["document"], NOTE)
        self.assertEqual(ItemNote.objects.get(item_id=item).plain_text, "Café\nBench, β")
        invalid = [{"paragraphs": [[{"text": "unsafe", "link": "data:text/plain,hello"}]]},
                   {"paragraphs": [[{"text": "unsafe", "html": "not a supported field"}]]}]
        for value in invalid:
            self.set_note(item, value, 422)
        self.assertEqual(self.metadata(item).json()["document"], NOTE)
        self.command("undo", {"operationId": receipt["operationId"], "contextId": receipt["contextId"]})
        self.assertEqual(self.metadata(item).json()["document"]["paragraphs"], [])

    def test_upload_download_sanitized_preview_replay_and_no_bytes_in_lists(self):
        item = self.capture(["A13"])[0]
        raw = b"bench\n"
        first = self.upload_headers(item, raw)
        saved = self.upload(item, raw, first)
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(self.upload(item, raw, first).json(), saved.json())
        image = self.upload_headers(item, PNG, "pin.png", **{"X-File-Type": "image/png"})
        self.assertEqual(self.upload(item, PNG, image).status_code, 200)
        files = self.metadata(item).json()["files"]
        self.assertEqual([f["size"] for f in files], [6, 70])
        for content, headers in ((raw, first), (PNG, image)):
            link = headers["X-File-Id"]
            downloaded = self.download(item, link)
            self.assertEqual(downloaded.content, content)
            self.assertTrue(downloaded["Content-Disposition"].startswith("attachment;"))
            self.assertEqual(downloaded["X-Content-Type-Options"], "nosniff")
            self.assertIn("no-store", downloaded["Cache-Control"])
        preview = self.download(item, image["X-File-Id"], "preview")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview["Content-Type"], "image/png")
        self.assertTrue(preview.content.startswith(PNG[:8]))
        self.assertEqual(self.download(item, first["X-File-Id"], "preview").status_code, 415)
        for suffix in ("snapshot", "outline?view=inbox"):
            result = self.client.get(self.base + suffix)
            self.assertNotContains(result, image["X-File-Sha256"])
            self.assertNotContains(result, "bench.txt")
        self.assertEqual(AttachmentBlob.objects.count(), 2)
        self.assertEqual(AttachmentBody.objects.count(), 2)
        inverse = Receipt.objects.get(operation_id=image["X-Operation-Id"]).inverse
        self.assertNotIn(base64.b64encode(PNG).decode(), str(inverse))

    def test_viewer_cross_workspace_and_revocation_recheck_metadata_preview_bytes_and_writes(self):
        item = self.capture(["A13"])[0]
        headers = self.upload_headers(item, PNG)
        self.assertEqual(self.upload(item, PNG, headers).status_code, 200)
        link = headers["X-File-Id"]
        self.client.force_login(self.other)
        for mode in ("download", "preview"):
            self.assertEqual(self.download(item, link, mode).status_code, 404)
        self.assertEqual(self.metadata(item).status_code, 404)
        self.assertEqual(self.upload(item, PNG, headers).status_code, 404)
        viewer = Membership.objects.create(workspace=self.space, user=self.other, role="viewer")
        self.assertEqual(self.metadata(item).status_code, 200)
        self.assertEqual(self.download(item, link, "preview").status_code, 200)
        self.assertEqual(self.upload(item, PNG, headers).status_code, 403)
        viewer.delete()
        self.assertEqual(self.download(item, link).status_code, 404)
        self.assertEqual(self.metadata(item).status_code, 404)

    def test_duplicate_and_trash_restore_share_immutable_sql_body_and_preserve_independent_note(self):
        item = self.capture(["A13"])[0]
        self.set_note(item, NOTE)
        raw = b"bench\n"
        headers = self.upload_headers(item, raw)
        self.assertEqual(self.upload(item, raw, headers).status_code, 200)
        duplicate = self.command("duplicate", {"ids": [item]})["selection"][0]
        copy = self.metadata(duplicate).json()
        self.assertEqual(copy["document"], NOTE)
        self.assertNotEqual(copy["files"][0]["id"], headers["X-File-Id"])
        self.assertEqual(self.download(duplicate, copy["files"][0]["id"]).content, raw)
        self.set_note(duplicate, {"paragraphs": [[{"text": "Separate"}]]})
        self.assertEqual(self.metadata(item).json()["document"], NOTE)
        self.command("delete", {"ids": [item]})
        self.assertEqual(self.download(item, headers["X-File-Id"]).status_code, 404)
        self.command("restore", {"ids": [item]})
        self.assertEqual(self.download(item, headers["X-File-Id"]).content, raw)
        self.assertEqual(AttachmentBody.objects.count(), 1)
        self.command("complete", {"ids": [item]})
        self.command("archive", {"ids": [item], "before": (timezone.now().date() + timedelta(days=2)).isoformat()})
        self.assertEqual(self.metadata(item).status_code, 404)
        restored = self.command("retrieve", {"ids": [item]})["selection"][0]
        self.assertNotEqual(restored, item)
        archived_copy = self.metadata(restored).json()
        self.assertEqual(archived_copy["document"], NOTE)
        self.assertEqual(self.download(restored, archived_copy["files"][0]["id"]).content, raw)
        self.assertEqual(AttachmentBody.objects.count(), 1)

    @override_settings(ATTACHMENT_MAX_BYTES=6, WORKSPACE_ATTACHMENT_MAX_BYTES=6)
    def test_limits_checksum_and_undo_relink_capacity(self):
        item = self.capture(["A13"])[0]
        raw = b"bench\n"
        invalid = self.upload_headers(item, raw, **{"X-File-Sha256": "a" * 64})
        self.assertEqual(self.upload(item, raw, invalid).status_code, 422)
        too_large = raw + b"x"
        self.assertEqual(self.upload(item, too_large, self.upload_headers(item, too_large)).status_code, 413)
        self.assertFalse(AttachmentBody.objects.exists())
        upload = self.upload_headers(item, raw)
        self.assertEqual(self.upload(item, raw, upload).status_code, 200)
        self.assertEqual(self.upload(item, b"x", self.upload_headers(item, b"x")).status_code, 413)
        removed = self.command("remove-file", {"id": item, "itemVersion": self.version(item),
                                                 "fileId": upload["X-File-Id"]})
        with override_settings(WORKSPACE_ATTACHMENT_MAX_BYTES=1):
            self.command("undo", {"contextId": removed["contextId"], "operationId": removed["operationId"]}, 413)
        other = b"second"
        self.assertEqual(self.upload(item, other, self.upload_headers(item, other)).status_code, 200)
        self.assertEqual(len(self.metadata(item).json()["files"]), 1)

    @override_settings(ATTACHMENT_HISTORY_MAX_BYTES=0)
    def test_history_prune_reclaims_only_unlinked_bytes_and_guarded_undo_conflicts(self):
        item = self.capture(["A13"])[0]
        h = self.upload_headers(item, b"old")
        self.assertEqual(self.upload(item, b"old", h).status_code, 200)
        remove = self.command("remove-file", {"id": item, "itemVersion": self.version(item), "fileId": h["X-File-Id"]})
        self.assertFalse(AttachmentBody.objects.exists())
        self.command("undo", {"contextId": remove["contextId"], "operationId": remove["operationId"]}, 409)
        self.assertEqual(self.metadata(item).json()["files"], [])

    def test_mislabeled_image_download_only_and_database_rejects_foreign_relationship(self):
        item = self.capture(["A13"])[0]
        raw = b"plain specimen"
        header = self.upload_headers(item, raw, "misnamed.png", **{"X-File-Type": "image/png"})
        self.assertEqual(self.upload(item, raw, header).status_code, 200)
        self.assertEqual(self.download(item, header["X-File-Id"], "preview").status_code, 415)
        with self.assertRaises(IntegrityError), transaction.atomic():
            AttachmentLink.objects.create(workspace=self.foreign, item_id=item, filename="wrong", blob=AttachmentBlob.objects.get())
            with connection.cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
