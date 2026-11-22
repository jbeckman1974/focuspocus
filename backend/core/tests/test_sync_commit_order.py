"""Exercise the snapshot watermark across two real PostgreSQL connections."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connections, transaction
from django.test import Client, TransactionTestCase

from core.access import locked_membership
from core.commands.context import issue_context
from core.commands.service import execute
from core.models import Membership, Workspace


class SnapshotOrderTests(TransactionTestCase):
    def test_snapshot_waits_for_the_inflight_commit_and_returns_its_cursor(self):
        actor = get_user_model().objects.create_user(username="concurrent-fixture")
        space = Workspace.objects.create(private_owner=actor)
        Membership.objects.create(workspace=space, user=actor, role="owner")
        new_id = str(uuid.uuid4())
        seen_row, release_writer, reading = Event(), Event(), Event()
        body = {
            "context": issue_context(space, actor), "operationId": str(uuid.uuid4()),
            "expectedRevision": 0,
            "payload": {"parentId": "inbox", "items": [{"id": new_id, "title": "Cable"}]},
        }

        def write():
            try:
                with transaction.atomic():
                    execute(actor, space.pk, "capture", body)
                    seen_row.set()
                    if not release_writer.wait(timeout=10):
                        raise TimeoutError("Reader did not reach workspace acquisition")
            finally:
                connections.close_all()

        def observe_read(user, workspace_id):
            reading.set()
            return locked_membership(user, workspace_id)

        def read():
            try:
                browser = Client()
                browser.force_login(actor)
                with patch("core.sync.views.locked_membership", side_effect=observe_read):
                    response = browser.get(f"/api/v1/workspaces/{space.pk}/snapshot")
                return response.json()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            writer = executor.submit(write)
            try:
                self.assertTrue(seen_row.wait(timeout=10))
                reader = executor.submit(read)
                self.assertTrue(reading.wait(timeout=10))
            finally:
                release_writer.set()
            writer.result(timeout=15)
            snapshot = reader.result(timeout=15)
        self.assertEqual(snapshot["revision"], 1)
        self.assertEqual([row["id"] for row in snapshot["tasks"]], [new_id])
        self.client.force_login(actor)
        changes = self.client.get(
            f"/api/v1/workspaces/{space.pk}/changes", {"after": snapshot["cursor"]}
        ).json()
        self.assertEqual((changes["changes"], changes["revision"]), ([], 1))
