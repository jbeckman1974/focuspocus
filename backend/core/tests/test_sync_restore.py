import io
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from core.models import Item, Membership, PasswordRecovery, Workspace
from core.sync.jobs import claim, enqueue_probe, finish, heartbeat, heartbeat_fresh


class RestoreFenceTests(TestCase):
    def test_old_browser_jobs_and_reset_grants_do_not_cross_restore(self):
        actor = get_user_model().objects.create_user(username="restore-fixture")
        workspace = Workspace.objects.create(private_owner=actor)
        Membership.objects.create(workspace=workspace, user=actor, role="owner")
        item = Item.objects.create(workspace=workspace, title="Before restore", position=1, kind="action")
        PasswordRecovery.objects.create(
            user=actor, digest=uuid.uuid4().hex, expires_at=timezone.now() + timedelta(minutes=1)
        )
        base = f"/api/v1/workspaces/{workspace.pk}/"
        self.client.force_login(actor)
        snapshot = self.client.get(base + "snapshot").json()
        pending = enqueue_probe(actor, workspace.pk, uuid.uuid4())
        leased = claim()
        heartbeat()

        call_command("fence_restored_database", stdout=io.StringIO())
        self.assertEqual(self.client.get(base + "snapshot").status_code, 401)
        self.assertFalse(PasswordRecovery.objects.exists())
        self.assertFalse(heartbeat_fresh())
        self.assertFalse(finish(leased))
        pending.refresh_from_db()
        self.assertEqual((pending.status, pending.last_error), ("failed", "restore_reconciliation"))
        self.client.force_login(actor)
        self.assertEqual(self.client.get(base + "changes", {"after": snapshot["cursor"]}).status_code, 410)
        request = {
            "operationId": str(uuid.uuid4()), "context": snapshot["context"],
            "expectedRevision": snapshot["revision"],
            "payload": {"items": [{"id": str(uuid.uuid4()), "title": "Should not replay"}], "parentId": "inbox"},
        }
        self.assertEqual(
            self.client.post(base + "commands/capture", request, content_type="application/json").status_code,
            410,
        )
        after = self.client.get(base + "snapshot").json()
        self.assertNotEqual(snapshot["generation"], after["generation"])
        self.assertEqual(after["tasks"][0]["id"], str(item.pk))
        self.assertEqual(len(after["tasks"]), 1)
