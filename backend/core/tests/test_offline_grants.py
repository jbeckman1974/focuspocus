from datetime import datetime, timedelta
from io import StringIO
from unittest.mock import patch
from uuid import UUID, uuid4

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from core.models import Change, Membership, PerspectiveState, Receipt
from core.sync import grants
from .outline_case import OutlineApiMixin


class OfflineGrantTests(OutlineApiMixin, TestCase):
    def snapshot(self):
        return self.client.get(self.base + "snapshot").json()

    def test_snapshot_grants_and_focus_belong_to_the_member(self):
        Membership.objects.create(workspace=self.space, user=self.other, role="editor")
        missing_root = str(uuid4())
        PerspectiveState.objects.create(workspace=self.space, user=self.owner, focus_ids=[missing_root], version=2)
        owner = self.snapshot()
        stamp = owner["offlineGrant"]
        self.assertEqual(str(UUID(stamp["id"])), stamp["id"])
        self.assertEqual(stamp["protocol"], 1)
        self.assertLess(abs(datetime.fromisoformat(stamp["expiresAt"]) - timezone.now() - grants.RETENTION),
                        timedelta(seconds=5))
        self.assertEqual(owner["focusScopeIds"], [missing_root])
        self.assertEqual(owner["perspectiveVersion"], 2)
        self.assertEqual(stamp["id"], self.snapshot()["offlineGrant"]["id"])
        self.client.force_login(self.other)
        editor = self.snapshot()
        self.assertNotEqual(stamp["id"], editor["offlineGrant"]["id"])
        self.assertEqual((editor["focusScopeIds"], editor["perspectiveVersion"]), ([], 0))

    def test_content_snapshot_and_subtree_tombstones_match_the_open_workspace(self):
        parent, child = self.capture(["Route", "Review"])
        self.command("indent", {"ids": [child]})
        before = self.snapshot()
        content = self.client.get(self.base + f"content/items/{child}").json()
        self.assertEqual(content["generation"], before["generation"])
        self.assertEqual(content["offlineGrant"]["id"], before["offlineGrant"]["id"])
        self.command("delete", {"ids": [parent]})
        first = self.client.get(self.base + "changes", {"after": before["cursor"]}).json()
        self.assertEqual(len(first["changes"]), 1)
        self.assertCountEqual(first["changes"][0]["removed"], [parent, child])
        self.assertFalse(self.snapshot()["tasks"])
        self.command("restore", {"ids": [parent]})
        second = self.client.get(self.base + "changes", {"after": first["cursor"]}).json()
        self.assertEqual(second["changes"][0]["removed"], [])
        self.assertCountEqual([task["id"] for task in self.snapshot()["tasks"]], [parent, child])

    def test_role_round_trip_and_rejoin_invalidate_writes_receipts_and_cursors(self):
        member = Membership.objects.create(workspace=self.space, user=self.other, role="editor")
        self.client.force_login(self.other)
        initial = self.snapshot()
        self.context = initial["context"]
        body = self.envelope({"parentId": "inbox", "items": [{"id": str(uuid4()), "title": "One receipt"}]})
        self.assertEqual(self.send("capture", body).status_code, 200)
        member.role = "viewer"
        member.save(update_fields=["role"])
        self.assertEqual(self.send("capture", body).status_code, 403)
        self.assertEqual(self.client.get(self.base + "changes", {"after": initial["cursor"]}).status_code, 410)
        member.role = "editor"
        member.save(update_fields=["role"])
        returned = self.snapshot()
        self.assertNotEqual(initial["offlineGrant"]["id"], returned["offlineGrant"]["id"])
        self.assertEqual(self.send("capture", body).status_code, 410)
        member.delete()
        self.assertEqual(self.send("capture", body).status_code, 404)
        Membership.objects.create(workspace=self.space, user=self.other, role="editor")
        rejoined = self.snapshot()
        self.assertNotEqual(returned["offlineGrant"]["id"], rejoined["offlineGrant"]["id"])
        for snapshot in (initial, returned):
            self.assertEqual(self.client.get(self.base + "changes", {"after": snapshot["cursor"]}).status_code, 410)
            self.assertEqual(self.send("capture", {**body, "context": snapshot["context"]}).status_code, 410)
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(Change.objects.count(), 1)

    def test_schema_change_and_restore_fence_original_operation(self):
        initial = self.snapshot()
        self.context = initial["context"]
        body = self.envelope({"parentId": "inbox", "items": [{"id": str(uuid4()), "title": "Original"}]})
        self.assertEqual(self.send("capture", body).status_code, 200)
        with patch.object(grants, "PROTOCOL", grants.PROTOCOL + 1):
            self.assertEqual(self.send("capture", body).status_code, 410)
            self.assertEqual(self.client.get(self.base + "changes", {"after": initial["cursor"]}).status_code, 410)
        call_command("fence_restored_database", stdout=StringIO())
        self.assertEqual(self.send("capture", body).status_code, 401)
        self.client.force_login(self.owner)
        self.assertNotEqual(self.snapshot()["offlineGrant"]["id"], initial["offlineGrant"]["id"])
        self.assertEqual(self.send("capture", body).status_code, 410)
