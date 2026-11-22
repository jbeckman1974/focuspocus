import unittest
from datetime import datetime, timezone

from core.scheduling.dates import DateContext
from core.scheduling.recurrence import next_occurrence
from core.scheduling.repeat_rule import RepeatRule


UTC = timezone.utc


def stamp(value):
    return {"kind": "floating", "value": value}


def day(value):
    return {"kind": "date", "value": value}


class RepeatCalendarTests(unittest.TestCase):
    def setUp(self):
        self.context = DateContext("America/New_York", datetime(2026, 11, 21, 15, tzinfo=UTC))
        self.a22 = {"due": stamp("2026-11-18T09:00")}
        self.a23 = {"defer": stamp("2026-11-13T10:00"), "planned": stamp("2026-11-15T10:00"),
                    "due": stamp("2026-11-18T10:00")}

    def advance(self, rule, values, **kwargs):
        return next_occurrence(rule, values, self.context, **kwargs)

    def consecutive(self, rule, date, count=3):
        initial = {"due": day(date)}
        current = initial
        results = []
        for _ in range(count):
            current = self.advance(rule, current, origin=initial).schedule
            results.append(current["due"]["value"])
        return results

    def test_at09_catchup_consumes_only_one_completion_and_honors_final_occurrence(self):
        rule = {"schedule": "regular", "unit": "day", "count": 4}
        self.assertEqual(self.advance(rule, self.a22).schedule["due"]["value"], "2026-11-19T09:00")
        rule["catchUp"] = True
        future = self.advance(rule, self.a22)
        self.assertEqual((future.schedule["due"]["value"], future.remaining), ("2026-11-22T09:00", 3))
        for expected in (2, 1):
            future = self.advance(rule, future.schedule, origin=self.a22, remaining=future.remaining)
            self.assertEqual(future.remaining, expected)
        self.assertIsNone(self.advance(rule, future.schedule, origin=self.a22, remaining=1))
        self.assertEqual(self.advance(rule, self.a22, skip=True).remaining, 4)

    def test_inclusive_end_day_and_strictly_future_catchup_boundary(self):
        rule = {"schedule": "regular", "unit": "day", "endDate": "2026-11-22", "catchUp": True}
        target = self.advance(rule, self.a22, completed_at=datetime(2026, 11, 21, 14, tzinfo=UTC))
        self.assertEqual(target.schedule["due"]["value"], "2026-11-22T09:00")
        self.assertIsNone(self.advance(rule, target.schedule))

    def test_at10_each_completion_anchor_maintains_the_two_and_three_day_offsets(self):
        for anchor, days in (("defer", ["11-28", "11-30", "12-03"]),
                             ("planned", ["11-26", "11-28", "12-01"]),
                             ("due", ["11-23", "11-25", "11-28"])):
            rule = {"schedule": "completion", "unit": "day", "interval": 7, "anchor": anchor}
            result = self.advance(rule, self.a23)
            self.assertEqual([result.schedule[k]["value"] for k in ("defer", "planned", "due")],
                             ["2026-" + date + "T10:00" for date in days])
        rule = {"schedule": "regular", "unit": "week"}
        self.assertEqual(self.advance({**rule, "anchor": "defer"}, self.a23),
                         self.advance({**rule, "anchor": "due"}, self.a23))
        rule["weekdays"] = [0, 3]
        self.assertNotEqual(self.advance({**rule, "anchor": "defer"}, self.a23),
                            self.advance({**rule, "anchor": "due"}, self.a23))

    def test_month_end_and_leap_day_keep_the_series_origin(self):
        self.assertEqual(self.consecutive({"schedule": "regular", "unit": "month"}, "2027-01-31"),
                         ["2027-02-28", "2027-03-31", "2027-04-30"])
        self.assertEqual(self.consecutive({"schedule": "regular", "unit": "year"}, "2028-02-29", 4),
                         ["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"])

    def test_at11_fifth_friday_and_multiple_weekday_and_month_day_patterns(self):
        rule = {"schedule": "regular", "unit": "month", "ordinal": {"position": 5, "days": [4]}}
        self.assertEqual(self.consecutive(rule, "2027-01-29"), ["2027-04-30", "2027-07-30", "2027-10-29"])
        rule = {"schedule": "regular", "unit": "week", "weekdays": [0, 3], "interval": 2}
        self.assertEqual(self.consecutive(rule, "2027-01-04"), ["2027-01-07", "2027-01-18", "2027-01-21"])
        rule = {"schedule": "regular", "unit": "month", "monthDays": [15, 31, -1]}
        self.assertEqual(self.consecutive(rule, "2027-01-15"), ["2027-01-31", "2027-02-15", "2027-02-28"])

    def test_completion_hour_half_up_and_minute_precision(self):
        current = {"due": stamp("2026-11-21T07:45")}
        for unit, minute, second, expected in (("hour", 29, 59, "11:00"), ("hour", 30, 0, "12:00"),
                                               ("minute", 29, 29, "10:30"), ("minute", 29, 30, "10:31")):
            rule = {"schedule": "completion", "unit": unit}
            instant = datetime(2026, 11, 21, 15, minute, second, tzinfo=UTC)
            future = self.advance(rule, current, completed_at=instant)
            self.assertEqual(future.schedule["due"]["value"], "2026-11-21T" + expected)

    def test_minute_catch_up_jumps_decades_and_retains_unambiguous_fold(self):
        rule = {"schedule": "regular", "unit": "minute", "catchUp": True}
        current = {"due": stamp("2001-01-01T12:00")}
        result = self.advance(rule, current)
        self.assertEqual(result.schedule["due"]["value"], "2026-11-21T10:01")
        current = {"due": stamp("2027-11-07T01:59")}
        after = self.advance({**rule, "catchUp": False}, current)
        self.assertEqual(after.schedule["due"], {"kind": "floating", "value": "2027-11-07T01:00", "fold": 1})

    def test_daily_repeat_after_nonexistent_original_clock_returns_to_the_authored_time(self):
        initial = {"due": stamp("2027-03-14T02:30")}
        result = self.advance({"schedule": "regular", "unit": "day"}, initial)
        self.assertEqual(result.schedule["due"]["value"], "2027-03-15T02:30")

    def test_hourly_anchored_task_keeps_other_calendar_day_assignments(self):
        current = {"due": stamp("2027-01-04T08:30"), "planned": day("2027-01-04")}
        result = self.advance({"schedule": "regular", "unit": "hour"}, current)
        self.assertEqual(result.schedule["due"]["value"], "2027-01-04T09:30")
        self.assertEqual(result.schedule["planned"], day("2027-01-04"))
        current["due"] = stamp("2027-01-04T23:30")
        result = self.advance({"schedule": "regular", "unit": "hour"}, current)
        self.assertEqual(result.schedule["planned"], day("2027-01-05"))

    def test_validation_and_unrepresentable_final_year(self):
        base = {"schedule": "regular", "unit": "day"}
        for changes in ({"unit": "hour", "weekdays": [1]}, {"unit": "week", "weekdays": [1, True]},
                        {"interval": 0}, {"unit": "month", "monthDays": [0]}, {"endDate": "next month"},
                        {"schedule": "completion", "catchUp": True}, {"count": 4, "endDate": "2040-01-01"}):
            with self.assertRaises(ValueError):
                RepeatRule.from_wire({**base, **changes})
        self.assertIsNone(self.advance({**base, "unit": "year"}, {"due": day("9999-01-01")}))
        with self.assertRaises(ValueError):
            self.advance({**base, "unit": "hour"}, {"due": day("2027-01-01")})
