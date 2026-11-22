from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from django.test import TestCase

from core.integrations import ical
from core.integrations.models import CalendarEvent
from core.models import Job, Membership
from core.sync import jobs
from core.tests.outline_case import OutlineApiMixin
from core.tests.test_adapter_ical import event, feed, fixture


class CalendarServiceTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        config = {"calendars": {"work": {"username": self.owner.username, "label": "Project calendar",
                                         "url": "https://fixture.invalid/calendar"}}}
        self.config = patch("core.integrations.configuration.configuration", return_value=config)
        self.config.start()
        self.addCleanup(self.config.stop)

    def calendar(self, action):
        return self.client.post(self.base + "integrations/calendars", {"source": "work", "action": action},
                                content_type="application/json")

    def run_refresh(self, status, data):
        with patch("core.integrations.transport.transaction", return_value=(status, data)) as fetch:
            self.assertTrue(jobs.run_one())
            self.assertEqual(fetch.call_count, 1)

    def forecast(self, zone="America/New_York"):
        return self.client.get(self.base + "planning/forecast", {"start": "2026-11-21", "days": 3,
                                                                 "viewZone": zone}).json()["days"]

    def test_roundtrip_uid_update_cancel_failure_isolation_and_recovery(self):
        self.assertEqual(self.calendar("connect").status_code, 200)
        self.run_refresh(200, fixture())
        first = self.forecast()
        self.assertEqual([[e["title"] for e in d["events"]] for d in first],
                         [["Two, days"], ["Two, days", "Crew visit"], []])
        event_id = first[1]["events"][1]["id"]
        self.assertNotIn(event_id, first[1]["matchIds"])
        self.assertIn(event_id, [e["id"] for e in self.forecast("America/Los_Angeles")[0]["events"]])
        self.assertEqual(self.calendar("refresh").status_code, 200)
        self.run_refresh(200, fixture("Revised", 2))
        self.assertEqual(CalendarEvent.objects.count(), 2)
        self.assertEqual(self.forecast()[1]["events"][1]["id"], event_id)
        self.assertEqual(self.calendar("refresh").status_code, 200)
        self.run_refresh(200, feed(*event("UID:alpha", "STATUS:CANCELLED", "SEQUENCE:3")))
        self.assertEqual(CalendarEvent.objects.count(), 0)
        self.assertEqual(self.calendar("refresh").status_code, 200)
        self.run_refresh(200, fixture())
        self.assertEqual(self.calendar("refresh").status_code, 200)
        self.run_refresh(500, b"")
        state = self.client.get(self.base + "integrations/calendars").json()["connections"][0]
        self.assertEqual(state["status"], "calendar_refresh_failed")
        self.assertTrue(state["lastSuccess"])
        self.assertTrue(self.forecast()[0]["events"])
        self.calendar("refresh")
        self.run_refresh(401, b"")
        self.assertEqual(CalendarEvent.objects.count(), 0)
        self.calendar("refresh")
        self.run_refresh(200, fixture())
        Membership.objects.create(workspace=self.space, user=self.other, role="viewer")
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.base + "integrations/calendars").json(),
                         {"sources": [], "connections": []})
        self.assertFalse(any(d["events"] for d in self.forecast()))
        self.assertEqual(self.calendar("connect").status_code, 404)
        self.assertEqual(self.client.get(self.base + "integrations/calendars",
                                        HTTP_X_FOCUSPOCUS_ACTOR=str(self.owner.pk)).status_code, 403)
        self.client.force_login(self.owner)
        self.assertEqual(self.calendar("disconnect").json()["connections"], [])
        self.assertEqual(CalendarEvent.objects.count(), 0)

    def test_revoked_member_cannot_trigger_scheduled_fetch(self):
        self.calendar("connect")
        Membership.objects.filter(user=self.owner, workspace=self.space).delete()
        with patch("core.integrations.transport.transaction") as provider:
            self.assertTrue(jobs.run_one())
            provider.assert_not_called()
        self.assertEqual(Job.objects.get().last_error, "authorization_revoked")

    def test_first_calendar_connection_refreshes_an_already_open_forecast(self):
        instant = datetime(2026, 11, 21, 16, 0, tzinfo=timezone.utc)
        url = self.base + "planning/forecast"
        params = {"start": "2026-11-21", "days": 3, "viewZone": "America/New_York"}
        with patch("django.utils.timezone.now", return_value=instant):
            empty = self.client.get(url, params).json()
            self.assertEqual(empty["nextDateBoundary"], (instant + timedelta(minutes=1)).isoformat())
            self.assertFalse(any(day["events"] for day in empty["days"]))
            self.assertEqual(self.calendar("connect").status_code, 200)
            self.run_refresh(200, fixture())
            refreshed = self.client.get(url, params).json()
            self.assertTrue(refreshed["days"][0]["events"])
            self.calendar("disconnect")
            self.assertEqual(self.client.get(url, params).json()["nextDateBoundary"], empty["nextDateBoundary"])

            Membership.objects.create(workspace=self.space, user=self.other, role="viewer")
            self.client.force_login(self.other)
            next_day = datetime.fromisoformat(self.client.get(url, params).json()["nextDateBoundary"])
            self.assertEqual(next_day, datetime(2026, 11, 22, 5, 0, tzinfo=timezone.utc))

    def test_recurring_local_time_across_dst_exception_and_cancelled_instance(self):
        raw = feed(*event("UID:field", "DTSTART;TZID=America/New_York:20260302T090000",
                          "DURATION:PT1H", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
                          "EXDATE;TZID=America/New_York:20260316T090000"),
                   *event("UID:field", "RECURRENCE-ID:20260309T130000Z",
                          "DTSTART:20260309T150000Z", "DURATION:PT1H", "SUMMARY:Moved",
                          "SEQUENCE:1"),
                   *event("UID:field", "RECURRENCE-ID:20260323T130000Z", "STATUS:CANCELLED"))
        records = sorted(ical.parse(raw, today=date(2026, 3, 1)), key=lambda entry: entry["start"])
        self.assertEqual([r["start"] for r in records], ["2026-03-02T14:00:00+00:00",
                                                        "2026-03-09T15:00:00+00:00"])
        self.assertEqual(records[1]["end"], "2026-03-09T16:00:00+00:00")
        self.assertEqual(records[1]["title"], "Moved")
