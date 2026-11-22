"""Replay an upgrade using the actual M2 schema and real PostgreSQL JSON values."""

from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class ScheduleMigrationTests(TransactionTestCase):
    def test_m2_item_identity_completion_and_direct_due_survive_the_upgrade(self):
        executor = MigrationExecutor(connection)
        final_targets = executor.loader.graph.leaf_nodes()
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(final_targets))
        baseline = [("core", "0002_scoped_relationships")]
        executor.migrate(baseline)
        original = executor.loader.project_state(baseline).apps
        workspace = original.get_model("core", "Workspace").objects.create()
        Item = original.get_model("core", "Item")
        dated = Item.objects.create(workspace=workspace, title="Boundary survey", kind="action", position=100,
                                    due=date(2028, 2, 29), done=True, version=5)
        undated = Item.objects.create(workspace=workspace, title="Draft field notes", kind="action", position=200)
        # M2 has no per-row creation/completion timestamps to copy.
        event = original.get_model("core", "Change").objects.create(
            workspace=workspace, revision=1, affected=[str(dated.pk), str(undated.pk)]
        )

        scheduled = [("core", "0005_schedule_fields")]
        upgraded = MigrationExecutor(connection)
        upgraded.migrate(scheduled)
        apps = upgraded.loader.project_state(scheduled).apps
        items = apps.get_model("core", "Item").objects.filter(workspace_id=workspace.pk)
        done = items.get(pk=dated.pk)
        self.assertEqual(done.schedule, {"due": {"kind": "date", "value": "2028-02-29"}})
        self.assertEqual((done.due, done.done, done.position, done.version), (dated.due, True, 100, 5))
        self.assertEqual(done.changed_at, event.created_at)
        self.assertIsNone(done.created_at)
        self.assertIsNone(done.completed_at)
        self.assertEqual(items.get(pk=undated.pk).schedule, {})
        settings = apps.get_model("core", "Workspace").objects.get(pk=workspace.pk)
        self.assertEqual((settings.time_zone, settings.date_defaults), ("UTC", {}))
