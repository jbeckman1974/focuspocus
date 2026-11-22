"""An existing workspace can refresh its pre-grant client and keep its audit data."""

from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core import signing
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from core.models import Change, Membership, Receipt


class OfflineUpgradeTests(TransactionTestCase):
    def test_populated_workspace_reopens_with_a_new_context(self):
        migrations = MigrationExecutor(connection)
        latest = migrations.loader.graph.leaf_nodes()
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(latest))
        before = [("core", "0018_oidc")]
        migrations.migrate(before)
        old = migrations.loader.project_state(before).apps
        actor = old.get_model("auth", "User").objects.create(username="upgrade-editor")
        workspace = old.get_model("core", "Workspace").objects.create(revision=1)
        membership = old.get_model("core", "Membership").objects.create(workspace=workspace, user=actor, role="editor")
        reader = old.get_model("auth", "User").objects.create(username="upgrade-reader")
        second = old.get_model("core", "Membership").objects.create(workspace=workspace, user=reader, role="viewer")
        context_id, operation_id = uuid4(), uuid4()
        recorded = old.get_model("core", "Receipt").objects.create(
            workspace=workspace, actor=actor, context_id=context_id, operation_id=operation_id,
            fingerprint="fixture", result={"revision": 1},
        )
        old.get_model("core", "Change").objects.create(workspace=workspace, revision=1, affected=[])
        legacy_context = signing.dumps([str(workspace.pk), str(workspace.generation), str(actor.pk), str(context_id)],
                                       salt="focuspocus.workspace-write.v1")
        legacy_cursor = signing.dumps([str(actor.pk), str(workspace.pk), str(workspace.generation), 1],
                                      salt="focuspocus.workspace-changes.v1")

        MigrationExecutor(connection).migrate(latest)
        stamp = Membership.objects.get(pk=membership.pk).incarnation
        self.assertIsNotNone(stamp)
        self.assertNotEqual(stamp, Membership.objects.get(pk=second.pk).incarnation)
        self.assertEqual(Change.objects.get(workspace_id=workspace.pk).removed, [])
        self.assertEqual(Receipt.objects.get(pk=recorded.pk).operation_id, operation_id)
        self.client.force_login(get_user_model().objects.get(pk=actor.pk))
        base = f"/api/v1/workspaces/{workspace.pk}/"
        snapshot = self.client.get(base + "snapshot").json()
        self.assertEqual(snapshot["revision"], 1)
        self.assertEqual(snapshot["offlineGrant"]["protocol"], 1)
        self.assertEqual(self.client.get(base + "changes", {"after": legacy_cursor}).status_code, 410)
        envelope = {"operationId": str(operation_id), "expectedRevision": 1, "context": legacy_context,
                    "payload": {"parentId": "inbox", "items": [{"id": str(uuid4()), "title": "Post-upgrade"}]}}
        self.assertEqual(self.client.post(base + "commands/capture", envelope, content_type="application/json").status_code, 410)
        fresh = {**envelope, "context": snapshot["context"], "operationId": str(uuid4())}
        self.assertEqual(self.client.post(base + "commands/capture", fresh, content_type="application/json").status_code, 200)
