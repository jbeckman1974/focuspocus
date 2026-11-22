from datetime import datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model

from core.tests.reference_api import ReferenceWorkspaceCase
from core.models import Membership, Workspace
from core.tests.reference_outline import FIXTURE_TIME, fixture_id


def calendar_date(value):
    return {"kind": "date", "value": value}


class ForecastApiTests(ReferenceWorkspaceCase):
    def setUp(self):
        super().setUp()
        self.send("set-date-settings", {"timeZone": "America/New_York"})

    def forecast(self, **params):
        with patch("django.utils.timezone.now", return_value=FIXTURE_TIME):
            return self.read("planning/forecast", start="2026-11-21", **params)

    def test_at07_planned_date_moves_without_changing_due_or_availability(self):
        task = self.ids["A18"]
        self.send("set-schedule", {"ids": [task], "schedule": {
            "planned": calendar_date("2026-11-21"), "due": calendar_date("2026-11-25")}})
        original = self.forecast()
        self.assertIn(task, original["days"][0]["matchIds"])
        self.send("set-schedule", {"ids": [task], "schedule": {"planned": calendar_date("2026-11-22")}})
        moved = self.forecast()
        self.assertNotIn(task, moved["days"][0]["matchIds"])
        days = {day["date"]: {s["kind"]: s["ids"] for s in day["sections"]} for day in moved["days"]}
        self.assertIn(task, days["2026-11-22"]["planned"])
        self.assertIn(task, days["2026-11-25"]["due"])
        row = next(row for row in moved["rows"] if row["id"] == task)
        self.assertTrue(row["effective"]["available"])
        self.assertNotIn(task, self.forecast(planned="0")["days"][1]["matchIds"])
        self.assertLessEqual(datetime.fromisoformat(moved["nextDateBoundary"]).timestamp(),
                             datetime.fromisoformat("2026-11-22T00:00:00-05:00").timestamp())

    def test_at32_grouped_sections_overlap_and_combined_deduplicates(self):
        task, tag = self.ids["A18"], str(fixture_id(self.space, "Field"))
        self.send("set-schedule", {"ids": [task], "schedule": {"due": calendar_date("2026-11-21")}})
        self.send("set-properties", {"ids": [task], "flagged": True})
        grouped = self.forecast(tagId=tag, flagged="1")["days"][0]
        by_kind = {section["kind"]: section["ids"] for section in grouped["sections"]}
        for field in ("due", "tagged", "flagged"):
            self.assertIn(task, by_kind[field])
        combined = self.forecast(layout="combined", tagId=tag, flagged="1")["days"][0]
        self.assertEqual(combined["sections"], [{"kind": "combined", "ids": grouped["matchIds"]}])
        self.assertEqual(combined["matchIds"].count(task), 1)

    def test_travel_changes_display_day_and_held_projects_are_hidden_by_default(self):
        task = self.ids["A14"]
        self.send("set-schedule", {"ids": [task], "schedule": {
            "due": {"kind": "instant", "value": "2026-11-22T05:30Z"}}})
        self.assertFalse(any(row["id"] == task for row in self.forecast()["rows"]))
        eastern = self.forecast(includeHeld="1", viewZone="America/New_York")["days"]
        pacific = self.forecast(includeHeld="1", viewZone="America/Los_Angeles")["days"]
        self.assertIn(task, eastern[1]["matchIds"])
        self.assertIn(task, pacific[0]["matchIds"])

    def test_forecast_never_reads_another_workspace_and_validates_range(self):
        self.assertNotIn(self.private_id, str(self.forecast()))
        foreign = Workspace.objects.exclude(pk=self.space.pk).get()
        url = f"/api/v1/workspaces/{foreign.pk}/planning/forecast"
        self.assertEqual(self.client.get(url).status_code, 404)
        for params, status in (({"days": "63"}, 400), ({"days": "0"}, 400), ({"deferred": "yes"}, 400),
                               ({"viewZone": "../none"}, 422), ({"start": "bad"}, 422),
                               ({"tagId": "bad"}, 422), ({"start": "9999-12-31", "days": "2"}, 400)):
            with self.subTest(params=params):
                self.assertEqual(self.client.get(self.base + "planning/forecast", params).status_code, status)
        self.client.logout()
        self.assertEqual(self.client.get(self.base + "planning/forecast").status_code, 401)

    def test_forecast_and_review_refuse_stale_tab_for_a_shared_workspace(self):
        other = get_user_model().objects.create_user(username="planning-viewer")
        Membership.objects.create(workspace=self.space, user=other, role="viewer")
        self.client.force_login(other)
        for route in ("planning/forecast", "planning/review"):
            with self.subTest(route=route):
                stale = self.client.get(self.base + route, HTTP_X_FOCUSPOCUS_ACTOR=str(self.owner.pk))
                self.assertEqual(stale.status_code, 403)
                self.assertEqual(set(stale.json()), {"error"})
                accepted = self.client.get(self.base + route, HTTP_X_FOCUSPOCUS_ACTOR=str(other.pk))
                self.assertEqual(accepted.status_code, 200)
