from datetime import date, datetime
from unittest.mock import patch
from uuid import uuid4

from django.db import IntegrityError, connection, transaction

from core.models import Item, Membership, Workspace
from core.planning.cadence import advance
from core.planning.models import ProjectReview
from core.tests.reference_api import ReferenceWorkspaceCase
from core.tests.reference_outline import ZONE


class ReviewApiTests(ReferenceWorkspaceCase):
    def setUp(self):
        super().setUp()
        self.send("set-date-settings", {"timeZone": "America/New_York"})
        self.project = self.ids["P06"]
        # The documented register puts the other five projects in next week's queue.
        for label in ("P01", "P02", "P03", "P04", "P05"):
            self.send("set-review", {"projectId": self.ids[label], "nextReview": "2026-11-28"})
        self.send("set-review", {"projectId": self.project, "interval": 7, "unit": "day",
                                 "nextReview": "2026-11-21"})

    def mark(self, day):
        now = datetime(2026, 11, day, 10, tzinfo=ZONE)
        with patch("django.utils.timezone.now", return_value=now):
            self.send("mark-reviewed", {"projectId": self.project})
            return next(row for row in self.read("planning/review", scope="all")["projects"]
                        if row["projectId"] == self.project)

    def test_at15_queue_and_guarded_mark_do_not_change_completion(self):
        with patch("django.utils.timezone.now", return_value=datetime(2026, 11, 21, 10, tzinfo=ZONE)):
            before = self.read("planning/review")
            self.assertEqual([row["projectId"] for row in before["projects"]], [self.project])
            version = before["projects"][0]["version"]
            snap = self.read("snapshot")
            envelope = {"expectedRevision": snap["revision"], "context": snap["context"],
                        "operationId": str(uuid4()), "payload": {"projectId": self.project, "expectedVersion": version}}
            url = self.base + "commands/mark-reviewed"
            result = self.client.post(url, envelope, content_type="application/json")
            self.assertEqual(result.status_code, 200, result.content)
            self.assertEqual(self.client.post(url, envelope, content_type="application/json").json(), result.json())
            self.assertEqual(self.read("planning/review")["projects"], [])
            after = next(row for row in self.read("planning/review", scope="all")["projects"]
                         if row["projectId"] == self.project)
            self.assertEqual(after["nextReview"], "2026-11-28")
            self.assertEqual(after["lastReviewedBy"], str(self.owner.pk))
            self.assertEqual(after["status"], "active")
            self.assertEqual(after["interval"], 7)
            self.assertEqual(after["version"], version + 1)
            self.send("mark-reviewed", {"projectId": self.project, "expectedVersion": version}, status=409)
            self.send("undo", {"operationId": result.json()["operationId"], "contextId": result.json()["contextId"]})
            reverted = self.read("planning/review")["projects"]
            self.assertEqual(len(reverted), 1)
            self.assertEqual(reverted[0]["projectId"], self.project)
            self.assertIsNone(reverted[0]["lastReviewedAt"])

    def test_early_and_late_use_the_workspace_review_day(self):
        early = self.mark(19)
        self.assertEqual(early["nextReview"], "2026-11-26")
        late = self.mark(23)
        self.assertEqual(late["nextReview"], "2026-11-30")
        self.assertEqual(late["status"], "active")

    def test_invalid_intervals_or_foreign_project_cannot_mutate(self):
        initial = self.read("planning/review", scope="all")
        for invalid in ({"interval": 0}, {"interval": True}, {"unit": "hours"}, {"nextReview": None}):
            self.send("set-review", {"projectId": self.project, **invalid}, status=422)
        self.send("mark-reviewed", {"projectId": self.private_id}, status=404)
        self.send("mark-reviewed", {"projectId": self.ids["A18"]}, status=422)
        self.assertEqual(self.read("planning/review", scope="all")["revision"], initial["revision"])
        foreign = Workspace.objects.exclude(pk=self.space.pk).get()
        self.assertEqual(self.client.get(f"/api/v1/workspaces/{foreign.pk}/planning/review").status_code, 404)
        Membership.objects.filter(workspace=self.space, user=self.owner).update(role="viewer")
        self.send("mark-reviewed", {"projectId": self.project}, status=403)
        self.assertEqual(self.read("planning/review", scope="all")["projects"], initial["projects"])

    def test_project_creation_and_duplicate_initialize_independent_stable_calendars(self):
        project_id = str(uuid4())
        with patch("django.utils.timezone.now", return_value=datetime(2026, 11, 21, 1, tzinfo=ZONE)):
            self.send("create-container", {"id": project_id, "title": "New project"})
            copy_id = self.send("duplicate", {"ids": [project_id]})["selection"][0]
        self.send("set-date-settings", {"timeZone": "America/Los_Angeles"})
        for project in (project_id, copy_id):
            persisted = ProjectReview.objects.get(workspace=self.space, project_id=project)
            self.assertEqual(persisted.next_review, date(2026, 11, 28))
            self.assertIsNone(persisted.last_actor)

    def test_calendar_units_and_cross_workspace_constraint(self):
        self.assertEqual(advance(date(2028, 1, 31), 1, "month"), date(2028, 2, 29))
        self.assertEqual(advance(date(2028, 2, 29), 1, "year"), date(2029, 2, 28))
        project = Item.objects.get(pk=self.project)
        foreign = Workspace.objects.exclude(pk=self.space.pk).get()
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProjectReview.objects.filter(project=project).update(workspace=foreign)
            with connection.cursor() as cursor:
                cursor.execute("SET CONSTRAINTS review_owned_project IMMEDIATE")
