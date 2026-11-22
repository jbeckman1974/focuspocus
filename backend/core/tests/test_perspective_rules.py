import unittest

from core.commands.validation import CommandError
from core.perspectives.definition import validate_definition
from core.perspectives.evaluate import Evaluation
from core.perspectives.presentation import grouping, ordered
from core.queries.outline import tree_order


def item(key, name, **values):
    return {"id": key, "kind": "action", "parentId": "inbox", "title": name, "tags": [],
            "durationMinutes": None, "effective": {"status": "active", "remaining": True, "flagged": False,
            "schedule": {}}, "repeat": None, **values}


class PerspectiveRuleTests(unittest.TestCase):
    def test_ranges_sort_stably_and_leave_undated_last(self):
        rows = [item("x", "Photo 12", durationMinutes=8), item("y", "Photo 2", durationMinutes=4),
                item("z", "Other")]
        evaluator = Evaluation(rows, [], tree_order(rows, None), {}, "America/New_York")
        definition, _ = validate_definition({"version": 1, "expression": {"field": "duration", "value": {"min": 4, "max": 8}},
                                             "sortBy": "title"})
        self.assertEqual([r["id"] for r in ordered([r for r in rows if evaluator.predicate(definition["expression"])(r)],
                                                   definition)], ["y", "x"])
        for direction in ("asc", "desc"):
            self.assertEqual(ordered(rows, {**definition, "sortBy": "duration", "direction": direction})[-1]["id"], "z")

    def test_effective_day_is_interpreted_in_view_zone(self):
        row = item("x", "Deadline")
        row["effective"]["schedule"]["due"] = {"value": {"kind": "instant", "value": "2026-11-22T03:00:00Z"},
                                                "instant": "2026-11-22T03:00:00+00:00"}
        evaluator = Evaluation([row], [], tree_order([row], None), {}, "America/New_York")
        pred = {"field": "due", "value": {"from": "2026-11-21", "through": "2026-11-21"}}
        self.assertTrue(evaluator.predicate(pred)(row))
        self.assertEqual(grouping([row], "due", evaluator)[0]["key"], "2026-11-21")

    def test_grammar_is_bounded_and_dates_and_types_are_checked(self):
        nested = {"all": []}
        for _ in range(9):
            nested = {"none": [nested]}
        cases = [nested, {"any": [{"all": []}] * 100}, {"field": "flagged", "value": "true"},
                 {"field": "due", "value": {"from": "2026-02-31"}}, {"field": "duration", "value": {"max": False}},
                 {"field": "duration", "value": {"min": 6, "max": 5}}, {"field": "secret", "value": "x"}]
        for expr in cases:
            with self.subTest(expr=expr), self.assertRaises(CommandError):
                validate_definition({"version": 1, "expression": expr})
