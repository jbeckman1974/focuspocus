from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.db import connections
from django.test import Client, TransactionTestCase, override_settings

from core.content.models import AttachmentBlob, AttachmentBody, AttachmentLink

from .test_item_content import FileApiMixin


@override_settings(ATTACHMENT_MAX_BYTES=6, WORKSPACE_ATTACHMENT_MAX_BYTES=7)
class ConcurrentFileQuotaTests(FileApiMixin, TransactionTestCase):
    def test_two_server_connections_compete_for_remaining_bytes(self):
        item = self.capture(["A13"])[0]
        choices = [b"left", b"right"]
        requests = [(raw, self.upload_headers(item, raw)) for raw in choices]
        start = Barrier(2, timeout=10)

        def write(option):
            raw, headers = option
            client = Client()
            client.cookies.update(self.client.cookies)
            try:
                start.wait()
                response = client.post(self.base + f"content/items/{item}/files", raw,
                                       content_type="application/octet-stream", headers=headers)
                return response.status_code, raw
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(write, requests))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        loser = next(raw for status, raw in results if status == 409)
        self.assertEqual(self.upload(item, loser, self.upload_headers(item, loser)).status_code, 413)
        self.assertEqual(AttachmentLink.objects.count(), 1)
        self.assertEqual(AttachmentBlob.objects.count(), 1)
        self.assertEqual(AttachmentBody.objects.count(), 1)
