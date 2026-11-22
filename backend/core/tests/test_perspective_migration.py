"""Upgrade a populated M4 database while keeping replay identities and shared history intact."""

from hashlib import sha256
from uuid import uuid4

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class PerspectiveReceiptMigrationTests(TransactionTestCase):
    def test_compaction_preserves_acknowledgement_and_other_receipts(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(latest))
        before = [("core", "0012_preferences")]
        executor.migrate(before)
        apps = executor.loader.project_state(before).apps
        owner = apps.get_model("auth", "User").objects.create(username="receipt-owner")
        workspace = apps.get_model("core", "Workspace").objects.create(private_owner=owner)
        Receipt = apps.get_model("core", "Receipt")

        def receipt(label, result, inverse):
            return Receipt.objects.create(
                workspace=workspace, actor=owner, context_id=uuid4(), operation_id=uuid4(),
                fingerprint=sha256(label.encode()).hexdigest(), result=result, inverse=inverse,
            )

        old = receipt("personal", {"personalVersion": 4, "focusIds": [str(uuid4())],
                                   "perspectives": [{"name": "Historical name"}]}, {})
        shared = receipt("shared", {"revision": 8, "versions": {}, "selection": []}, {"journal": {"schema": 1}})
        compact = receipt("compact", {"personalVersion": 5}, {})

        after = [("core", "0013_compact_perspective_receipts")]
        upgrade = MigrationExecutor(connection)
        upgrade.migrate(after)
        migrated = upgrade.loader.project_state(after).apps.get_model("core", "Receipt")
        for original, expected in ((old, {"personalVersion": 4}), (shared, shared.result), (compact, compact.result)):
            row = migrated.objects.get(pk=original.pk)
            self.assertEqual(row.result, expected)
            for field in ("workspace_id", "actor_id", "context_id", "operation_id", "fingerprint", "inverse", "created_at"):
                self.assertEqual(getattr(row, field), getattr(original, field))
