from datetime import datetime
from unittest.mock import patch

from core.tests.reference_api import ReferenceWorkspaceCase
from core.tests.reference_outline import FIXTURE_TIME, ZONE


def day(value):
    return {"kind": "date", "value": value}


def expected_stored_days(schedule):
    clocks = {"defer": "00:00", "planned": "00:00", "due": "17:00"}
    return {field: {**intent, "defaultTime": clocks[field]} for field, intent in schedule.items()}


class ReferenceDateTests(ReferenceWorkspaceCase):
    def setUp(self):
        super().setUp()
        self.send("set-date-settings", {"timeZone": "America/New_York"})

    def set_schedule(self, key, schedule, **values):
        return self.send("set-schedule", {"ids": [self.ids[key]], "schedule": schedule, **values})

    def test_at03_clock_unblocks_the_first_sequential_action_without_a_write(self):
        self.set_schedule("A01", {"defer": {"kind": "floating", "value": "2026-11-22T09:00"}})
        options = {"projectId": self.ids["P01"], "view": "projects", "availability": "available"}
        with patch("django.utils.timezone.now", return_value=FIXTURE_TIME):
            before = self.read("outline", **options)
        self.assertEqual(before["matchIds"], [])
        self.assertEqual(before["actionCount"], 0)
        self.assertIsNotNone(before["nextDateBoundary"])
        boundary = datetime.fromisoformat(before["nextDateBoundary"].replace("Z", "+00:00"))
        self.assertEqual(boundary, datetime(2026, 11, 22, 9, tzinfo=ZONE))
        with patch("django.utils.timezone.now", return_value=datetime(2026, 11, 22, 9, 1, tzinfo=ZONE)):
            after = self.read("outline", **options)
            self.assertEqual(after["revision"], before["revision"])
            self.assertEqual(after["matchIds"], [self.ids["A01"]])
            self.assertEqual(after["actionCount"], 1)
            self.send("complete", {"ids": [self.ids["A01"]]})
            self.assertEqual(self.read("outline", **options)["matchIds"], [self.ids["A02"]])

    def test_at05_inherited_dates_recompute_and_direct_child_dates_survive_a_move(self):
        group_dates = {"defer": day("2026-11-20"), "planned": day("2026-11-23"), "due": day("2026-11-30")}
        child_dates = {"defer": day("2026-11-22"), "planned": day("2026-11-24"), "due": day("2026-11-25")}
        self.set_schedule("G03", group_dates)
        self.set_schedule("A10", child_dates)

        def record(key, project_key):
            rows = self.read("outline", view="projects", availability="everything",
                             projectId=self.ids[project_key])["rows"]
            return next(row for row in rows if row["id"] == self.ids[key])

        inherited = record("A09", "P02")["effective"]["schedule"]
        for name, intent in expected_stored_days(group_dates).items():
            self.assertEqual(inherited[name]["source"], self.ids["G03"])
            self.assertEqual(inherited[name]["value"], intent)
        self.send("move", {"ids": [self.ids["A09"], self.ids["A10"]], "parentId": self.ids["P03"]})
        cleared = record("A09", "P03")["effective"]["schedule"]
        self.assertTrue(all(cleared.get(name) is None for name in group_dates))
        direct = record("A10", "P03")
        stored = expected_stored_days(child_dates)
        self.assertEqual(direct["schedule"], stored)
        for name, intent in stored.items():
            self.assertEqual(direct["effective"]["schedule"][name]["value"], intent)
            self.assertEqual(direct["effective"]["schedule"][name]["source"], self.ids["A10"])

    def test_at07_planned_date_and_duration_do_not_block_independently_scheduled_work(self):
        dates = {"planned": day("2026-11-21"), "due": day("2026-11-25")}
        self.set_schedule("A18", dates, durationMinutes=30)
        self.set_schedule("A18", {"planned": day("2026-11-22")})
        with patch("django.utils.timezone.now", return_value=FIXTURE_TIME):
            view = self.read("outline", view="projects", projectId=self.ids["P06"], availability="available")
        self.assertIn(self.ids["A18"], view["matchIds"])
        row = next(item for item in view["rows"] if item["id"] == self.ids["A18"])
        self.assertEqual(row["schedule"], expected_stored_days({
            "planned": day("2026-11-22"), "due": dates["due"],
        }))
        self.assertEqual(row["durationMinutes"], 30)
