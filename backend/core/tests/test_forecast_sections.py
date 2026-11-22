import unittest
from datetime import date, datetime, timezone

from core.planning.sections import forecast_days
from core.scheduling.dates import DateContext


class ForecastSectionTests(unittest.TestCase):
    def test_overlap_reuses_ids_and_each_calendar_zone_has_its_own_day(self):
        at = datetime(2026, 11, 21, 22, tzinfo=timezone.utc)
        row = {
            "kind": "action", "id": "a", "parentId": "inbox", "status": "active", "tags": ["t"],
            "effective": {"remaining": True, "flagged": True,
                          "schedule": {"due": {"instant": "2026-11-22T05:30:00+00:00"}}},
        }
        for zone, due_day in (("America/New_York", 1), ("America/Los_Angeles", 0)):
            options = dict(clock=DateContext(zone, at), start=date(2026, 11, 21), days=2, enabled_dates=["due"],
                           flagged=True, tags={"t"}, include_held=False)
            groups, rows = forecast_days([row], layout="grouped", **options)
            self.assertEqual(rows, [row])
            self.assertIn({"kind": "due", "ids": ["a"]}, groups[due_day]["sections"])
            combined, _ = forecast_days([row], layout="combined", **options)
            self.assertEqual(combined[0]["matchIds"], ["a"])
            hidden, _ = forecast_days([row], layout="combined", focus=set(), **options)
            self.assertTrue(all(not day["matchIds"] for day in hidden))
