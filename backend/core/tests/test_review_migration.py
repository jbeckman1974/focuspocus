"""Exercise the first project-review upgrade on existing and legacy project rows."""

from datetime import date, datetime, timedelta, timezone

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class ReviewMigrationTests(TransactionTestCase):
    def test_existing_projects_get_independent_workspace_calendar_dates(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(latest))
        before = [("core", "0008_freeze_legacy_due_clock")]
        executor.migrate(before)
        apps = executor.loader.project_state(before).apps
        Workspace = apps.get_model("core", "Workspace")
        Item = apps.get_model("core", "Item")
        east = Workspace.objects.create(time_zone="America/New_York")
        west = Workspace.objects.create(time_zone="America/Los_Angeles")
        created = datetime(2026, 11, 22, 5, 30, tzinfo=timezone.utc)
        projects = [
            Item.objects.create(workspace=space, title="Calendar boundary", kind="project",
                                created_at=created, position=1024)
            for space in (east, west)
        ]
        legacy = Item.objects.create(workspace=west, title="Legacy project", kind="project",
                                     created_at=None, position=2048)
        Item.objects.create(workspace=west, title="Child action", kind="action",
                            parent=legacy, position=1024)
        with connection.cursor() as cursor:
            cursor.execute("SELECT (current_timestamp AT TIME ZONE %s)::date", [west.time_zone])
            earliest, = cursor.fetchone()
        after = [("core", "0009_review")]
        upgrade = MigrationExecutor(connection)
        upgrade.migrate(after)
        Review = upgrade.loader.project_state(after).apps.get_model("core", "ProjectReview")
        with connection.cursor() as cursor:
            cursor.execute("SELECT (current_timestamp AT TIME ZONE %s)::date", [west.time_zone])
            latest_day, = cursor.fetchone()
        self.assertEqual(Review.objects.count(), 3)
        for project, expected in zip(projects, (date(2026, 11, 29), date(2026, 11, 28))):
            review = Review.objects.get(project_id=project.pk)
            self.assertEqual((review.workspace_id, review.next_review), (project.workspace_id, expected))
            self.assertEqual((review.interval, review.unit, review.version), (1, "week", 1))
            self.assertIsNone(review.last_reviewed_at)
            self.assertIsNone(review.last_actor_id)
        legacy_day = Review.objects.get(project_id=legacy.pk).next_review
        self.assertLessEqual(earliest + timedelta(weeks=1), legacy_day)
        self.assertLessEqual(legacy_day, latest_day + timedelta(weeks=1))
