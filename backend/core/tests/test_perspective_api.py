from uuid import uuid4

from django.contrib.auth import get_user_model

from core.commands.context import issue_context
from core.content.models import ItemNote
from core.models import Change, Membership, Receipt
from core.tests.reference_api import ReferenceWorkspaceCase
from core.tests.reference_outline import fixture_id


class PersonalPerspectiveTests(ReferenceWorkspaceCase):
    def put(self, action, payload, version, actor=None):
        actor = actor or self.owner
        return {"action": action, "payload": payload, "expectedVersion": version,
                "context": issue_context(self.space, actor), "operationId": str(uuid4())}

    def post(self, path, body, status=200):
        response = self.client.post(self.base + "perspectives/" + path, body, content_type="application/json")
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def definition(self):
        return {"version": 1, "groupBy": "tag", "sortBy": "title", "expression": {"all": [
            {"field": "availability", "value": "remaining"},
            {"any": [{"field": "flagged", "value": True},
                     {"field": "tag", "value": str(fixture_id(self.space, "Field"))}]},
            {"none": [{"field": "tag", "value": str(fixture_id(self.space, "Wait"))}]},
        ]}}

    def save_body(self):
        return {"id": str(uuid4()), "name": "Bench readiness", "icon": "star", "favorite": True,
                "definition": self.definition()}

    def test_at14_persist_reopen_focus_and_search_title_note_tag(self):
        saved = self.save_body()
        self.post("commands", self.put("focus", {"ids": [self.ids["P06"]]}, 0))
        state = self.post("commands", self.put("save", saved, 1))
        self.assertEqual(state["personalVersion"], 2)
        self.assertTrue(self.read("perspectives/")["perspectives"][0]["favorite"])
        ItemNote.objects.create(workspace=self.space, item_id=self.ids["A26"], document={}, plain_text="Bench limits")
        query = {"perspectiveId": saved["id"]}
        result = self.post("query", query)
        self.assertCountEqual(result["matchIds"], [self.ids[k] for k in ("A18", "A26", "A27")])
        self.assertEqual(set(row["label"] for row in result["groups"]), {"Field", "Desk"})
        self.assertCountEqual(self.post("query", {**query, "text": "bench"})["matchIds"],
                              [self.ids["A18"], self.ids["A26"]])
        self.assertEqual(self.post("query", {**query, "text": "bench", "hereIds": [self.ids["A26"]]})["matchIds"],
                         [self.ids["A26"]])
        self.assertCountEqual(self.post("query", {**query, "text": "field", "scope": "remaining"})["matchIds"],
                              [self.ids[k] for k in ("A18", "A21", "A27")])
        self.assertEqual(self.post("query", {**query, "text": "Signed page", "scope": "everything"})["matchIds"],
                         [self.ids["A19"]])
        self.assertEqual(self.post("query", {**query, "text": "Clear gate", "scope": "everything"})["count"], 0)
        self.assertEqual(self.read("outline", view="projects", projectId=self.ids["P01"])["matchIds"], [])
        preview = self.post("query", {**query, "offset": 1, "limit": 1})
        self.assertEqual((preview["count"], preview["nextOffset"], preview["matchIds"]), (3, 2, result["matchIds"][1:2]))
        self.space.refresh_from_db()
        self.assertEqual(self.space.revision, 0)
        self.assertEqual(Change.objects.filter(workspace=self.space).count(), 0)

    def test_viewer_private_state_replay_conflict_and_revocation(self):
        other = get_user_model().objects.create_user(username="fixture-perspective-reader")
        member = Membership.objects.create(workspace=self.space, user=other, role="viewer")
        self.client.force_login(other)
        payload = self.save_body()
        body = self.put("save", payload, 0, actor=other)
        answer = self.post("commands", body)
        self.assertEqual(self.post("commands", body), answer)
        self.post("commands", {**body, "payload": {**payload, "name": "Changed"}}, 409)
        self.post("commands", self.put("delete", {"id": payload["id"]}, 0, actor=other), 409)
        self.client.force_login(self.owner)
        self.assertEqual(self.read("perspectives/")["perspectives"], [])
        self.post("query", {"perspectiveId": payload["id"]}, 404)
        self.post("commands", self.put("delete", {"id": payload["id"]}, 0), 404)
        self.client.force_login(other)
        member.delete()
        self.post("commands", body, 404)
        self.post("query", {"perspectiveId": payload["id"]}, 404)

    def test_receipts_keep_the_acknowledged_version_and_replay_the_current_catalog(self):
        payload = self.save_body()
        create = self.put("save", payload, 0)
        original = self.post("commands", create)
        receipt = Receipt.objects.get(workspace=self.space, actor=self.owner, operation_id=create["operationId"])
        self.assertEqual(receipt.result, {"personalVersion": 1})
        renamed = self.post("commands", self.put("save", {**payload, "name": "Revised field plan"}, 1))
        self.assertEqual(self.post("commands", create), renamed)
        # A receipt left by an older M4 build is also replayable before its data migration.
        Receipt.objects.filter(pk=receipt.pk).update(result=original)
        current = self.post("commands", self.put("delete", {"id": payload["id"]}, 2))
        self.assertEqual(self.post("commands", create), {"personalVersion": 3, "focusIds": [], "perspectives": []})
        self.assertEqual(self.read("perspectives/"), current)
        self.assertEqual(Receipt.objects.filter(workspace=self.space, actor=self.owner).count(), 3)

    def test_actor_pinned_browser_requests_reject_shared_workspace_account_switch(self):
        viewer = get_user_model().objects.create_user(username="perspective-shared-reader")
        Membership.objects.create(workspace=self.space, user=viewer, role="viewer")
        self.client.force_login(viewer)
        self.post("commands", self.put("save", self.save_body(), 0, actor=viewer))
        wrong = {"HTTP_X_FOCUSPOCUS_ACTOR": str(self.owner.pk)}
        base = self.base + "perspectives/"
        self.assertEqual(self.client.get(base, **wrong).status_code, 403)
        self.assertEqual(self.client.post(base + "query", {}, content_type="application/json", **wrong).status_code, 403)
        command = self.put("focus", {"ids": [self.ids["P06"]]}, 1, actor=viewer)
        self.assertEqual(self.client.post(base + "commands", command, content_type="application/json", **wrong).status_code, 403)
        own = self.client.get(base, HTTP_X_FOCUSPOCUS_ACTOR=str(viewer.pk)).json()
        self.assertEqual((own["personalVersion"], own["focusIds"]), (1, []))

    def test_cross_workspace_reference_rejected_and_stale_focus_does_not_broaden(self):
        foreign = {"field": "contains", "value": self.private_id}
        self.post("query", {"definition": {"version": 1, "expression": foreign}}, 404)
        self.post("commands", self.put("focus", {"ids": [self.private_id]}, 0), 404)
        self.post("commands", self.put("focus", {"ids": [self.ids["P06"]]}, 0))
        self.send("delete", {"ids": [self.ids["P06"]]})
        self.assertEqual(self.post("query", {"scope": "everything"})["count"], 0)

    def test_here_accepts_large_outline_but_preserves_focus_and_workspace(self):
        self.post("commands", self.put("focus", {"ids": [self.ids["P06"]]}, 0))
        here = [str(uuid4()) for _ in range(11_097)]
        here.extend([self.ids["A18"], self.ids["P01"], self.private_id])
        result = self.post("query", {"scope": "here", "hereIds": here})
        self.assertEqual((result["count"], result["matchIds"]), (1, [self.ids["A18"]]))

    def test_invalid_input_and_undoable_shared_history_unchanged(self):
        for bad in ({"scope": "private"}, {"offset": -1}, {"viewZone": []}, {"hereIds": [True]},
                    {"text": "bad\x00text"}, {"text": "\ud800"},
                    {"definition": {"version": 99, "expression": {"all": []}}},
                    {"definition": {"version": 1, "expression": {"sql": "arbitrary"}}}):
            self.post("query", bad, 422)
        payload = self.save_body()
        self.post("commands", self.put("save", payload, 0))
        edited = self.post("commands", self.put("save", {**payload, "name": "New name"}, 1))
        self.assertEqual(edited["perspectives"][0]["version"], 2)
        self.post("commands", self.put("delete", {"id": payload["id"]}, 2))
        self.assertEqual(self.read("perspectives/")["perspectives"], [])
