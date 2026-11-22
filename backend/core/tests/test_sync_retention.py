from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone

from core.models import CaptureAcknowledgement, CaptureCredential, Change, Item, Receipt, RestoredHistory
from core.sync.grants import RETENTION
from core.sync.retention import prune_batch
from .outline_case import OutlineApiMixin


class SyncRetentionTests(OutlineApiMixin, TestCase):
    def test_batches_preserve_history_and_expire_receipts_and_feed_gaps(self):
        initial = self.client.get(self.base + "snapshot").json()
        previous = timezone.now() - RETENTION - timedelta(seconds=10)
        rows = self.capture(["Retained", "Other"])
        self.command("bulk-edit", {"ids": rows, "title": "Edited"})
        Receipt.objects.update(created_at=previous)
        Change.objects.update(created_at=previous)
        self.capture(["Fresh"])
        RestoredHistory.objects.create(workspace=self.space, occurred_at=previous + timedelta(seconds=1),
                                       action="capture", item_ids=[])
        endpoint = self.base + "portability/history"
        before = self.client.get(endpoint).json()
        self.assertEqual(prune_batch(limit=1), (1, 1))
        self.assertEqual(prune_batch(limit=1), (1, 1))
        self.assertEqual(prune_batch(limit=1), (0, 0))
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(Change.objects.count(), 1)
        self.assertEqual(RestoredHistory.objects.count(), 3)
        self.assertEqual(self.client.get(endpoint).json(), before)
        self.assertEqual(self.client.get(self.base + "changes", {"after": initial["cursor"]}).status_code, 410)
        fresh = self.client.get(self.base + "snapshot").json()
        self.assertEqual({task["id"] for task in fresh["tasks"]}, set(str(pk) for pk in Item.objects.values_list("pk", flat=True)))
        self.assertEqual(self.client.get(self.base + "changes", {"after": fresh["cursor"]}).status_code, 200)

    def test_lost_acknowledgement_after_expiry_does_not_recreate_work(self):
        before = timezone.now() - RETENTION - timedelta(days=1)
        with patch("django.core.signing.time.time", return_value=before.timestamp()):
            self.context = self.client.get(self.base + "snapshot").json()["context"]
            body = self.envelope({"parentId": "inbox", "items": [{"id": str(uuid4()), "title": "Preserve once"}]})
            self.assertEqual(self.send("capture", body).status_code, 200)
        Receipt.objects.update(created_at=before)
        self.assertEqual(prune_batch(), (1, 0))
        self.assertEqual(self.send("capture", body).status_code, 410)
        self.assertEqual(Item.objects.count(), 1)

    def test_scoped_capture_renewal_remains_idempotent_after_receipt_expiry(self):
        created = self.client.post(self.base + "sharing/credentials", {"label": "Test capture"},
                                   content_type="application/json", headers={"X-FocusPocus-Actor": str(self.owner.pk)})
        self.assertEqual(created.status_code, 200)
        header = {"Authorization": "Bearer " + created.json()["token"]}
        def send(path, body):
            return self.client.post("/api/v1/capture" + path, body, content_type="application/json", headers=header)

        token = send("/context", {}).json()["context"]
        body = {"context": token, "operationId": str(uuid4()), "title": "Keep this capture"}
        first = send("", body)
        self.assertEqual(first.status_code, 200)
        Receipt.objects.update(created_at=timezone.now() - RETENTION - timedelta(seconds=30))
        self.assertEqual(prune_batch(), (1, 0))
        self.assertEqual(Receipt.objects.count(), 0)
        self.assertEqual(CaptureAcknowledgement.objects.count(), 1)
        renewed = send("/context", {}).json()["context"]
        self.assertEqual(send("", {**body, "context": renewed}).json(), first.json())
        self.assertEqual(send("", {**body, "context": renewed, "title": "Changed request"}).status_code, 409)
        self.assertEqual(Item.objects.count(), 1)
        CaptureCredential.objects.all().delete()
        self.assertFalse(CaptureAcknowledgement.objects.exists())
        self.assertEqual(send("", body).status_code, 401)
