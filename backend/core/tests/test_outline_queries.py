from uuid import uuid4

from django.test import TestCase

from core.models import Change, Item
from .outline_case import OutlineApiMixin


class OutlineRuleApiTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.project = str(uuid4())
        self.command("create-container", {"id": self.project, "title": "Punch list"})
        self.actions = self.capture(["Battery", "Photos", "Café ledger"], parent=self.project)

    def query(self, view, availability="everything", **opts):
        response = self.client.get(self.base + "outline", {"view": view, "availability": availability, **opts})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_at02_modes_select_the_same_ordered_action_ids_in_list_and_count(self):
        snapshot = self.client.get(self.base + "snapshot").json()
        self.assertEqual(snapshot["projects"][0]["mode"], "parallel")
        first = self.actions[:1]
        for mode, available, first_available in [("parallel", self.actions, first), ("sequential", first, first),
                                                 ("single-action", self.actions, self.actions)]:
            self.command("set-properties", {"ids": [self.project], "mode": mode})
            for availability, expected in [("available", available), ("first-available", first_available)]:
                with self.subTest(mode=mode, availability=availability):
                    result = self.query("projects", availability, projectId=self.project)
                    self.assertEqual(result["matchIds"], expected)
                    self.assertEqual((result["count"], result["actionCount"]), (len(expected), len(expected)))
                    self.assertEqual([(row["id"], row["context"]) for row in result["rows"]],
                                     [(self.project, True)] + [(pk, False) for pk in expected])
        self.command("complete", {"ids": first})
        self.assertEqual(self.query("projects", "remaining", projectId=self.project)["matchIds"], self.actions[1:])
        self.assertEqual(self.query("projects", projectId=self.project)["matchIds"], [self.project, *self.actions])

    def test_views_show_inherited_flags_direct_completion_and_latest_edit(self):
        self.command("set-properties", {"ids": [self.project], "flagged": True})
        flagged = self.query("flagged")
        self.assertEqual(flagged["matchIds"], [self.project, *self.actions])
        self.assertFalse(flagged["rows"][1]["flagged"])
        self.assertEqual(flagged["rows"][1]["effective"]["flagSource"], self.project)
        self.command("complete", {"ids": self.actions[:1]})
        self.assertEqual(self.query("completed")["matchIds"], self.actions[:1])
        self.command("bulk-edit", {"ids": self.actions[2:], "title": "Ledger"})
        self.assertEqual(self.query("changed")["matchIds"][0], self.actions[2])
        self.assertEqual(self.query("inbox")["rows"], [])

    def test_mixed_invalid_property_write_is_atomic_and_success_replays(self):
        self.command("set-properties", {"ids": [self.project, self.actions[0]], "mode": "sequential"}, 422)
        snapshot = self.client.get(self.base + "snapshot").json()
        self.assertEqual(snapshot["projects"][0]["mode"], "parallel")
        for value in (True, [], None, "unknown"):
            self.command("set-properties", {"ids": [self.project], "status": value}, 422)
        body = self.envelope({"ids": [self.project], "flagged": True})
        one, two = self.send("set-properties", body), self.send("set-properties", body)
        self.assertEqual(one.status_code, 200, one.content)
        self.assertEqual(one.json(), two.json())
        self.assertEqual(Change.objects.filter(workspace=self.space).count(), 3)
        self.command("set-properties", {"ids": [self.project], "mode": "single-action", "autoComplete": True}, 422)

    def test_foreign_workspace_and_hidden_scope_never_leak_rows_or_counts(self):
        foreign = Item.objects.create(workspace=self.foreign, kind="project", title="Private project", position=1024)
        for scope in (str(foreign.pk), str(uuid4())):
            response = self.client.get(self.base + "outline", {"view": "projects", "projectId": scope})
            self.assertEqual((response.status_code, response.json()), (404, {"error": "Project unavailable."}))
        for params in ({"view": "inbox", "projectId": self.project}, {"availability": "unsupported"}, {"maximum": "all"}):
            self.assertEqual(self.client.get(self.base + "outline", params).status_code, 400)
        self.client.force_login(self.other)
        missing = self.client.get(f"/api/v1/workspaces/{uuid4()}/outline")
        other = self.client.get(self.base + "outline")
        self.assertEqual((other.status_code, other.json()), (missing.status_code, missing.json()))
        self.assertEqual(other.status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.base + "outline").status_code, 401)
