import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from core.rules.availability import Node, evaluate


NOW = datetime(2026, 11, 21, 15, tzinfo=timezone.utc)


def query(nodes, field, *, now=NOW):
    rows = evaluate(nodes, now=now)
    actions = {node.id for node in nodes if node.kind == "action"}
    return [key for key, row in rows.items() if key in actions and getattr(row, field)]


class AvailabilityTests(unittest.TestCase):
    def test_project_modes_keep_same_ids_and_order(self):
        project = Node("P03", None, "project", 1)
        actions = [Node(name, "P03", "action", position) for position, name in enumerate(("A11", "A12", "A13"))]
        for mode, available, first in [
            ("sequential", ["A11"], ["A11"]),
            ("parallel", ["A11", "A12", "A13"], ["A11"]),
            ("single-action", ["A11", "A12", "A13"], ["A11", "A12", "A13"]),
        ]:
            with self.subTest(mode=mode):
                data = list(reversed(actions)) + [replace(project, mode=mode)]
                self.assertEqual(query(data, "available"), available)
                self.assertEqual(query(data, "first_available"), first)

    def test_deferred_first_branch_prevents_a_later_sibling_from_skipping(self):
        deadline = NOW + timedelta(days=1)
        nodes = [Node("P01", None, "project", 0, mode="sequential"),
                 Node("A01", "P01", "action", 0, defer_until=deadline),
                 Node("A02", "P01", "action", 1)]
        self.assertEqual(query(nodes, "remaining"), ["A01", "A02"])
        self.assertEqual(query(nodes, "available"), [])
        self.assertEqual(evaluate(nodes, now=NOW)["A02"].reason_source, "A01")
        self.assertEqual(query(nodes, "available", now=deadline), ["A01"])
        nodes[1] = replace(nodes[1], status="completed")
        self.assertEqual(query(nodes, "available"), ["A02"])

    def test_nested_parallel_and_sequential_groups(self):
        branch = [Node("project", None, "project", 0, mode="sequential"),
                  Node("group", "project", "group", 1, mode="parallel"),
                  Node("one", "group", "action", 1), Node("two", "group", "action", 2),
                  Node("end", "project", "action", 2)]
        self.assertEqual(query(branch, "available"), ["one", "two"])
        self.assertEqual(query(branch, "first_available"), ["one"])
        branch[0] = replace(branch[0], mode="parallel")
        branch[1] = replace(branch[1], mode="sequential")
        self.assertEqual(query(branch, "available"), ["one", "end"])
        branch[2] = replace(branch[2], status="dropped")
        self.assertEqual(query(branch, "first_available"), ["two"])

    def test_latest_constraining_defer_is_reported_until_its_exact_boundary(self):
        first, last = NOW + timedelta(hours=1), NOW + timedelta(hours=4)
        nodes = [Node("project", None, "project", 0, defer_until=first),
                 Node("late", "project", "action", 0, defer_until=last),
                 Node("early", "project", "action", 1, defer_until=NOW)]
        result = evaluate(nodes, now=NOW)
        self.assertEqual(result["late"].reason_source, "late")
        self.assertEqual(result["early"].reason_source, "project")
        self.assertEqual(query(nodes, "available", now=first), ["early"])
        self.assertEqual(query(nodes, "available", now=last), ["late", "early"])

    def test_held_tag_blocks_actions_and_groups_without_holding_the_project(self):
        nodes = [Node("project", None, "project", 0, held_tag="tag"),
                 Node("group", "project", "group", 0, held_tag="tag"),
                 Node("nested", "group", "action", 0), Node("second", "project", "action", 1)]
        result = evaluate(nodes, now=NOW)
        self.assertTrue(result["project"].available)
        self.assertTrue(result["nested"].blocked)
        self.assertEqual(result["nested"].reason_source, "tag")
        self.assertEqual(query(nodes, "first_available"), ["second"])
        nodes[0] = replace(nodes[0], status="held")
        self.assertEqual(query(nodes, "available"), [])
        self.assertEqual(evaluate(nodes, now=NOW)["second"].reason_source, "project")

    def test_effective_status_and_flag_recompute_after_reparent(self):
        nodes = [Node("folder", None, "folder", 0, status="dropped"),
                 Node("project", "folder", "project", 0, flagged=True),
                 Node("child", "project", "action", 0)]
        inherited = evaluate(nodes, now=NOW)["child"]
        self.assertEqual((inherited.status, inherited.status_source, inherited.flag_source), ("dropped", "folder", "project"))
        self.assertFalse(inherited.remaining)
        nodes[-1] = replace(nodes[-1], parent_id=None)
        self.assertTrue(evaluate(nodes, now=NOW)["child"].available)
        self.assertFalse(evaluate(nodes, now=NOW)["child"].flagged)

    def test_separate_projects_each_have_a_first_action(self):
        nodes = [Node("p", None, "project", 0), Node("a", "p", "action", 0),
                 Node("q", None, "project", 1), Node("b", "q", "action", 0)]
        self.assertEqual(query(nodes, "first_available"), ["a", "b"])

    def test_deep_outline_without_recursive_traversal(self):
        nodes = [Node("root", None, "project", 0)]
        for depth in range(1200):
            nodes.append(Node(str(depth), nodes[-1].id, "group", 0))
        nodes.append(Node("leaf", nodes[-1].id, "action", 0))
        self.assertEqual(query(nodes, "first_available"), ["leaf"])
        with self.assertRaisesRegex(ValueError, "parent"):
            evaluate(nodes[1:], now=NOW)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            evaluate([nodes[0], nodes[0]], now=NOW)
