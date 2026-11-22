from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase

from core.models import Membership
from .outline_case import OutlineApiMixin


class ScheduleApiTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.project = str(uuid4())
        self.command("create-container", {"id": self.project, "title": "Survey"})
        self.children = self.capture(["Gate", "Set station"], parent=self.project)
        self.command("set-date-settings", {"timeZone": "America/New_York", "dateDefaults": {"defer": "09:00"}})

    def update(self, ids, **dates):
        return self.command("set-schedule", {"ids": ids, "schedule": dates})

    def projection(self, **params):
        response = self.client.get(self.base + "outline", {"view": "projects", "projectId": self.project, **params})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_defer_boundaries_advance_without_mutating_revision(self):
        self.command("set-properties", {"ids": [self.project], "mode": "sequential"})
        self.update(self.children[:1], defer={"kind": "date", "value": "2026-11-22"})
        before = datetime(2026, 11, 21, 15, tzinfo=timezone.utc)
        with patch("django.utils.timezone.now", return_value=before):
            blocked = self.projection(availability="available")
        self.assertEqual(blocked["matchIds"], [])
        self.assertEqual(blocked["nextDateBoundary"], "2026-11-22T14:00:00+00:00")
        with patch("django.utils.timezone.now", return_value=datetime.fromisoformat(blocked["nextDateBoundary"])):
            unlocked = self.projection(availability="available")
        self.assertEqual(unlocked["matchIds"], self.children[:1])
        self.assertEqual(unlocked["revision"], blocked["revision"])

    def test_constraint_source_move_legacy_due_and_fixed_intent(self):
        fixed = {"kind": "instant", "value": "2026-12-03T14:00:00Z"}
        self.update([self.project], due={"kind": "date", "value": "2026-12-01"}, planned=fixed)
        self.update(self.children[:1], due=fixed)
        row = next(row for row in self.projection()["rows"] if row["id"] == self.children[0])
        self.assertEqual(row["schedule"]["due"], fixed)
        self.assertEqual(row["effective"]["schedule"]["due"]["source"], self.project)
        self.command("bulk-edit", {"ids": self.children[:1], "due": row["due"]})
        self.command("move", {"ids": self.children[:1], "parentId": "inbox"})
        moved = self.client.get(self.base + "outline", {"view": "inbox"}).json()["rows"][0]
        self.assertEqual(moved["effective"]["schedule"]["due"]["value"], fixed)
        self.assertNotIn("planned", moved["effective"]["schedule"])
        self.command("bulk-edit", {"ids": self.children[:1], "due": None})
        snapshot = self.client.get(self.base + "snapshot").json()
        self.assertIsNone(next(row for row in snapshot["tasks"] if row["id"] == self.children[0])["due"])

    def test_preview_uses_named_timezone_and_date_default_is_captured_at_entry(self):
        clock = datetime(2026, 11, 21, 15, tzinfo=timezone.utc)
        with patch("django.utils.timezone.now", return_value=clock):
            preview = self.client.get(self.base + "date-preview", {"field": "defer", "text": "tomorrow"})
            self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["value"], {"kind": "date", "value": "2026-11-22", "defaultTime": "09:00"})
        self.update(self.children[:1], defer=preview.json()["value"])
        self.command("set-date-settings", {"dateDefaults": {"defer": "10:15"}})
        row = next(r for r in self.projection(viewZone="America/Chicago")["rows"] if r["id"] == self.children[0])
        self.assertEqual(row["effective"]["schedule"]["defer"]["instant"], "2026-11-22T15:00:00+00:00")
        self.assertEqual(row["schedule"]["defer"]["defaultTime"], "09:00")

    def test_invalid_schedule_rolls_back_and_prior_settings_receipt_needs_owner(self):
        self.command("set-schedule", {"ids": self.children, "durationMinutes": -2}, 422)
        self.command("set-schedule", {"ids": self.children, "schedule": {"defer": {"kind": "date", "value": "bad"}}}, 422)
        self.command("set-date-settings", {"timeZone": "Invalid/Place"}, 422)
        self.assertEqual(self.client.get(self.base + "date-preview", {"field": "due", "text": "nonsense"}).status_code, 422)
        body = self.envelope({"timeZone": "UTC"})
        self.assertEqual(self.send("set-date-settings", body).status_code, 200)
        Membership.objects.filter(workspace=self.space, user=self.owner).update(role="editor")
        self.assertEqual(self.send("set-date-settings", body).status_code, 403)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.base + "date-preview", {"field": "due", "text": "today"}).status_code, 404)
