"""Context rows, nested tag scopes and chronological ordering at the projection boundary."""

import unittest

from core.queries.outline import project_outline


def row(key, kind, parent, *, flags=False, tags=(), changed=None):
    return {
        "id": key, "kind": kind, "parentId": parent, "tags": list(tags), "status": "active",
        "changedAt": changed, "effective": {"available": True, "flagged": flags},
    }


class PerspectiveProjectionTests(unittest.TestCase):
    def test_nested_folder_and_tag_counts_exclude_outline_context(self):
        rows = [row("f1", "folder", "root"), row("f2", "folder", "f1"), row("p", "project", "f2"),
                row("t", "action", "p", tags=["field"]), row("i", "action", "inbox", tags=["desk"])]
        tags = [{"id": "venue", "parentId": None}, {"id": "field", "parentId": "venue"},
                {"id": "desk", "parentId": None}]
        for view, scope in [("projects", {"folder_id": "f2"}), ("tags", {"tag_id": "venue"})]:
            projection = project_outline(rows, tags, view=view, availability="available", **scope)
            self.assertEqual(projection["matchIds"], ["t"])
            self.assertEqual([r["context"] for r in projection["rows"]], [True, True, True, False])
            self.assertEqual(projection["actionCount"], 1)

    def test_deep_sparse_matches_keep_each_context_once_without_recursion(self):
        depth = 1500
        rows = [row("p", "project", "root")]
        for i in range(depth):
            rows.append(row(str(i), "group", rows[-1]["id"]))
        parent = rows[-1]["id"]
        rows.extend([row("a", "action", parent, flags=True), row("b", "action", parent, flags=True)])
        view = project_outline(rows, [], view="flagged", availability="everything")
        self.assertEqual(view["matchIds"], ["a", "b"])
        self.assertEqual(len(view["rows"]), depth + 3)
        self.assertEqual((view["count"], view["actionCount"]), (2, 2))

    def test_changed_uses_event_order_instead_of_parent_order(self):
        rows = [row("p", "project", "root", changed="2026-11-01T10:00:00+00:00"),
                row("a", "action", "p", changed="2026-11-22T10:00:00+00:00")]
        view = project_outline(rows, [], view="changed", availability="everything")
        self.assertEqual(view["matchIds"], ["a", "p"])
        self.assertFalse(any(row["context"] for row in view["rows"]))
