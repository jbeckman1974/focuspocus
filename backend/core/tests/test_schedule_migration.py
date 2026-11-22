"""Replay an upgrade using the actual M2 schema and real PostgreSQL JSON values."""

from datetime import date, datetime, timezone

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from core.scheduling.dates import DateContext, DateIntent


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
        second_workspace = original.get_model("core", "Workspace").objects.create()
        fallback = Item.objects.create(workspace=second_workspace, title="Index notes", kind="action",
                                       position=100, due=date(2028, 2, 29))
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
        settings.date_defaults = {"due": "19:30"}
        settings.save(update_fields=["date_defaults"])
        explicit = items.create(
            workspace=settings, title="Afternoon site visit", kind="action", position=300,
            due=date(2028, 2, 29), schedule={"due": {"kind": "date", "value": "2028-02-29", "defaultTime": "14:15"}},
        )

        frozen = [("core", "0008_freeze_legacy_due_clock")]
        upgrade = MigrationExecutor(connection)
        upgrade.migrate(frozen)
        apps = upgrade.loader.project_state(frozen).apps
        Item = apps.get_model("core", "Item")
        self.assertEqual(Item.objects.get(pk=fallback.pk).schedule["due"]["defaultTime"], "17:00")
        self.assertEqual(Item.objects.get(pk=explicit.pk).schedule["due"]["defaultTime"], "14:15")
        settings = apps.get_model("core", "Workspace").objects.get(pk=workspace.pk)
        settings.date_defaults = {"due": "08:00"}
        settings.save(update_fields=["date_defaults"])
        migrated = Item.objects.get(pk=dated.pk)
        clock = DateContext(settings.time_zone, datetime(2028, 2, 28, tzinfo=timezone.utc), settings.date_defaults)
        due = DateIntent.from_wire(migrated.schedule["due"])
        self.assertEqual(due.instant("due", clock), datetime(2028, 2, 29, 19, 30, tzinfo=timezone.utc))
        self.assertEqual((migrated.due, migrated.done, migrated.version), (dated.due, True, 5))
