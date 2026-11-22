import unittest
from datetime import datetime, timezone

from core.scheduling.dates import DateContext, DateIntent, direct_dates, duration_minutes, effective_dates, next_date_boundary
from core.scheduling.entry import preview_entry


def clock(zone="America/New_York"):
    return DateContext(zone, datetime(2026, 11, 21, 15, tzinfo=timezone.utc))


def day(value):
    return {"kind": "date", "value": value}


class CalendarDatesTests(unittest.TestCase):
    def test_parent_constrains_start_and_deadline_but_child_can_move_plan_either_way(self):
        context = clock()
        parent = effective_dates("G03", {
            "defer": day("2026-11-20"), "planned": day("2026-11-23"), "due": day("2026-11-30"),
        }, {}, context)
        for plan in ("2026-11-19", "2026-11-24"):
            direct = {"defer": day("2026-11-01"), "due": day("2026-12-15"), "planned": day(plan)}
            effective = effective_dates("A10", direct, parent, context)
            self.assertEqual([effective[key].source for key in ("defer", "planned", "due")], ["G03", "A10", "G03"])
            moved = effective_dates("A10", direct, {}, context)
            self.assertEqual(moved["due"].value.value, "2026-12-15")
            self.assertEqual(effective_dates("A09", {}, {}, context), {})

    def test_boundaries_expire_at_exact_instant_and_planned_does_not_create_defer(self):
        values = effective_dates("A01", {"defer": {"kind": "floating", "value": "2026-11-22T09:00"}}, {}, clock())
        boundary = datetime(2026, 11, 22, 14, tzinfo=timezone.utc)
        self.assertEqual(next_date_boundary(values, clock()), boundary)
        self.assertIsNone(next_date_boundary(values, DateContext("America/New_York", boundary)))
        other = effective_dates("A18", {"planned": day("2026-11-22"), "due": day("2026-11-25")}, {}, clock())
        self.assertNotIn("defer", other)
        self.assertEqual(other["due"].value.value, "2026-11-25")

    def test_travel_preserves_day_floating_clock_or_fixed_instant(self):
        coast = clock("America/Los_Angeles")
        for kind, value in (("date", "2026-11-22"), ("floating", "2026-11-22T09:00")):
            intent = DateIntent.from_wire({"kind": kind, "value": value})
            west = intent.instant("defer", coast)
            east = intent.instant("defer", clock())
            self.assertEqual((west-east).total_seconds(), 3*3600)
            self.assertEqual(west.astimezone(coast.zone).day, 22)
        for raw in ({"kind": "zoned", "zone": "America/New_York", "value": "2026-11-22T09:00"},
                    {"kind": "instant", "value": "2026-11-22T14:00:00Z"}):
            intent = DateIntent.from_wire(raw)
            self.assertEqual(intent.instant("due", coast), intent.instant("due", clock()))
            self.assertEqual(intent.wire(), raw)

    def test_gap_advances_and_overlap_can_select_either_instant(self):
        for value, fold, expected in (("2027-03-14T02:30", 0, "07:30"), ("2027-03-14T02:30", 1, "07:30"),
                                      ("2027-11-07T01:30", 0, "05:30"), ("2027-11-07T01:30", 1, "06:30")):
            intent = DateIntent.from_wire({"kind": "floating", "value": value, "fold": fold})
            self.assertEqual(intent.instant("defer", clock()).strftime("%H:%M"), expected)

    def test_input_preview_records_default_and_rejects_ambiguous_numeric_date(self):
        context = DateContext("America/New_York", clock().now, {"due": "19:30"})
        self.assertEqual(preview_entry("tomorrow", "due", context)["value"],
                         {"kind": "date", "value": "2026-11-22", "defaultTime": "19:30"})
        for expression in ("next Saturday at 10:00", "in 1 week 10:00", "2026-11-28T10:00"):
            self.assertEqual(preview_entry(expression, "defer", context)["instant"], "2026-11-28T15:00:00+00:00")
        for text in ("1/2/26", "in -1 days", "next saturday at 25:00", "2026-02-31"):
            with self.assertRaises(ValueError):
                preview_entry(text, "planned", context)

    def test_wire_validation_and_duration(self):
        for bad in ({"kind": "instant", "value": "2026-11-21T14:00"},
                    {"kind": "zoned", "zone": "../UTC", "value": "2026-11-21T14:00"},
                    {"kind": "date", "value": "2026-11-21", "fold": 1},
                    {"kind": "date", "value": "2026-11-21", "defaultTime": "24:30"},
                    {"kind": "floating", "value": "2026-11-21T14:00", "fold": True}):
            with self.assertRaises(ValueError):
                direct_dates({"due": bad})
        for bad in (True, -1, "45"):
            with self.assertRaises(ValueError):
                duration_minutes(bad)
        self.assertEqual(duration_minutes(30), 30)
