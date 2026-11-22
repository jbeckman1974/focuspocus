from collections import Counter

from core.models import Item
from core.tests.reference_api import ReferenceWorkspaceCase
from core.tests.reference_outline import fixture_id


class ReferenceOutlineTests(ReferenceWorkspaceCase):
    def test_seed_has_the_documented_hierarchy_identities_and_private_scope(self):
        rows = Item.objects.filter(workspace=self.space)
        self.assertEqual(Counter(rows.values_list("kind", flat=True)), {
            "folder": 2, "project": 6, "group": 4, "action": 30,
        })
        self.assertEqual(len(set(self.ids.values())), 42)
        self.assertEqual(str(fixture_id(self.space, "A18")), self.ids["A18"])
        self.assertEqual(self.child_ids(self.ids["G03"]), [self.ids["A09"], self.ids["A10"]])
        items = self.read("outline", view="projects", availability="everything")["rows"]
        self.assertNotIn(self.private_id, [item["id"] for item in items])
        self.assertNotIn("B private marker", [item["title"] for item in items])
        self.assertEqual(self.client.get(self.base + "items/" + self.private_id).status_code, 404)

    def test_at02_project_modes_change_eligibility_without_changing_identity_or_order(self):
        project = self.ids["P03"]
        leaves = [self.ids[key] for key in ("A11", "A12", "A13")]
        modes = [
            ("sequential", leaves[:1], leaves[:1]),
            ("parallel", leaves, leaves[:1]),
            ("single-action", leaves, leaves),
        ]
        for mode, available, first in modes:
            with self.subTest(mode=mode):
                self.send("set-properties", {"ids": [project], "mode": mode})
                for selector, expected in [("available", available), ("first-available", first)]:
                    result = self.read("outline", view="projects", availability=selector, projectId=project)
                    self.assertEqual(result["matchIds"], expected)
                    self.assertEqual(result["actionCount"], len(expected))
                    self.assertEqual([row["id"] for row in result["rows"] if not row["context"]], expected)
        self.send("complete", {"ids": leaves[:1]})
        for selector, expected in [("remaining", leaves[1:]), ("everything", leaves)]:
            result = self.read("outline", view="projects", availability=selector, projectId=project)
            self.assertEqual([row["id"] for row in result["rows"] if row["id"] in leaves], expected)

    def test_at27_duplicate_and_restore_preserve_order_and_independence(self):
        group = self.ids["G01"]
        first, second = self.ids["A03"], self.ids["A04"]
        self.send("reorder", {"parentId": group, "ids": [second], "beforeId": first})
        self.assertEqual(self.child_ids(group), [second, first])
        copied_group, = self.send("duplicate", {"ids": [group]})["selection"]
        self.assertNotIn(copied_group, self.ids.values())
        snapshot = self.read("snapshot")
        children = [task for task in snapshot["tasks"] if task["parentId"] == copied_group]
        self.assertEqual([task["title"] for task in children], ["A04 West tie", "A03 East tie"])
        copied_ids = [task["id"] for task in children]
        self.assertEqual(len(set(copied_ids)), 2)
        self.assertTrue(set(copied_ids).isdisjoint(self.ids.values()))
        self.send("bulk-edit", {"ids": copied_ids[:1], "title": "Independent copy"})
        self.assertEqual(self.read("items/" + second)["title"], "A04 West tie")
        prior_siblings = self.child_ids(self.ids["P01"])
        self.send("delete", {"ids": [group]})
        self.assertEqual(self.client.get(self.base + "items/" + first).status_code, 404)
        self.assertEqual(self.child_ids(copied_group), copied_ids)
        self.send("restore", {"ids": [group]})
        self.assertEqual(self.child_ids(self.ids["P01"]), prior_siblings)
        self.assertEqual(self.child_ids(group), [second, first])

    def test_at27_cutoff_and_retrieval_keep_the_archived_record(self):
        dropped, completed = self.ids["A20"], self.ids["A19"]
        cutoff = "2026-11-10"
        preview = self.read("archive-preview", before=cutoff)
        candidates = {item["id"] for item in preview["items"]}
        self.assertIn(dropped, candidates)
        self.assertNotIn(completed, candidates)
        self.send("archive", {"ids": [dropped], "before": cutoff})
        self.assertEqual(self.client.get(self.base + "items/" + dropped).status_code, 404)
        self.assertEqual(self.read("items/" + completed)["title"], "A19 Signed page")
        copy_id, = self.send("retrieve", {"ids": [dropped]})["selection"]
        self.assertNotEqual(copy_id, dropped)
        self.assertEqual(self.read("items/" + copy_id)["title"], "A20 Obsolete form")
        archive = self.read("shelf", state="archive")
        self.assertEqual([row["id"] for row in archive["items"]], [dropped])

    def test_at05_at32_standard_views_use_the_same_ids_after_a_move(self):
        inbox = self.read("outline", view="inbox", availability="everything")
        self.assertEqual(inbox["matchIds"], [self.ids[key] for key in ("I01", "I02", "I03")])
        completed = self.read("outline", view="completed", availability="everything")
        self.assertEqual(completed["matchIds"], [self.ids["A19"]])
        tag = str(fixture_id(self.space, "Field"))
        tagged = self.read("outline", view="tags", tagId=tag, availability="everything")
        self.assertEqual(set(tagged["matchIds"]), {self.ids[key] for key in ("A18", "A21", "A27")})
        blank, direct = self.ids["A09"], self.ids["A10"]
        before = self.read("outline", view="flagged", availability="everything")
        self.assertTrue({blank, direct, self.ids["G03"]}.issubset(before["matchIds"]))
        self.send("move", {"ids": [blank, direct], "parentId": self.ids["P03"]})
        after = self.read("outline", view="flagged", availability="everything")
        self.assertNotIn(blank, after["matchIds"])
        self.assertIn(direct, after["matchIds"])
        self.assertEqual(self.child_ids(self.ids["P03"])[-2:], [blank, direct])

    def test_at04_nested_modes_gate_the_next_sibling_until_the_group_resolves(self):
        project = self.ids["P01"]
        left, right = self.ids["A03"], self.ids["A04"]
        self.send("complete", {"ids": [self.ids["A01"], self.ids["A02"]]})

        def available():
            return self.read("outline", view="projects", projectId=project, availability="available")["matchIds"]

        self.assertEqual(available(), [left, right])
        self.send("complete", {"ids": [left]})
        self.assertEqual(available(), [right])
        self.send("complete", {"ids": [right]})
        self.assertEqual(available(), [self.ids["A05"]])
        self.assertTrue(self.read("items/" + self.ids["G01"])["done"])

    def test_at08_waiting_project_and_waiting_tag_filter_actions(self):
        held = self.read("outline", view="projects", projectId=self.ids["P04"], availability="available")
        self.assertNotIn(self.ids["A14"], held["matchIds"])
        project = self.ids["P06"]
        task = self.ids["A25"]
        query = {"view": "projects", "projectId": project, "availability": "available"}
        self.assertIn(task, self.read("outline", **query)["matchIds"])
        self.send("set-tags", {"ids": [task], "tagId": str(fixture_id(self.space, "Wait")), "enabled": True})
        self.assertNotIn(task, self.read("outline", **query)["matchIds"])
        remaining = self.read("outline", view="projects", projectId=project, availability="remaining")
        self.assertIn(task, remaining["matchIds"])
