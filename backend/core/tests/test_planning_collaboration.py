"""A reader can plan privately while another person's shared edits reach the same view."""

from uuid import uuid4

from django.contrib.auth import get_user_model

from core.models import Membership
from core.tests.reference_api import ReferenceWorkspaceCase
from core.tests.reference_outline import fixture_id


class PersonalPlanningIsolationTests(ReferenceWorkspaceCase):
    def post_json(self, route, body, status=200):
        response = self.client.post(self.base + route, body, content_type="application/json")
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def preference_envelope(self, action, payload):
        return {
            "context": self.read("snapshot")["context"],
            "operationId": str(uuid4()),
            "expectedVersion": self.read("perspectives/")["personalVersion"],
            "action": action,
            "payload": payload,
        }

    def test_at14_viewers_personal_focus_reopens_with_new_shared_content_and_requires_current_membership(self):
        user = get_user_model().objects.create_user(username="planner-reader")
        membership = Membership.objects.create(workspace=self.space, user=user, role="viewer")
        initial_order = self.child_ids(self.ids["P06"])
        self.client.force_login(user)
        field = str(fixture_id(self.space, "Field"))
        wait = str(fixture_id(self.space, "Wait"))
        view_id = str(uuid4())
        self.post_json("perspectives/commands", self.preference_envelope("focus", {"ids": [self.ids["P06"]]}))
        rule = {"all": [
            {"field": "availability", "value": "remaining"},
            {"any": [{"field": "flagged", "value": True}, {"field": "tag", "value": field}]},
            {"none": [{"field": "tag", "value": wait}]},
        ]}
        definition = {
            "version": 1, "expression": rule, "scopeIds": [], "groupBy": "tag",
            "sortBy": "title", "presentation": "list",
        }
        request = self.preference_envelope("save", {
            "id": view_id, "name": "My field list", "favorite": True, "icon": "star", "definition": definition,
        })
        saved = self.post_json("perspectives/commands", request)
        self.assertEqual(self.post_json("perspectives/commands", request), saved)
        query = {"perspectiveId": view_id, "scope": "here"}
        self.assertEqual(self.post_json("perspectives/query", query)["matchIds"],
                         [self.ids[key] for key in ("A18", "A26", "A27")])
        self.send("bulk-inspect", {"ids": [self.ids["A26"]], "changes": {"flagged": False}}, status=403)
        self.send("mark-reviewed", {"projectId": self.ids["P06"]}, status=403)

        self.client.force_login(self.owner)
        self.assertEqual(self.read("perspectives/")["perspectives"], [])
        self.post_json("perspectives/query", query, status=404)
        row = next(item for item in self.read("snapshot")["tasks"] if item["id"] == self.ids["A26"])
        self.send("set-note", {
            "id": row["id"], "itemVersion": row["version"],
            "document": {"paragraphs": [[{"text": "bench capacity", "bold": True}]]},
        })
        self.client.force_login(user)
        searched = self.post_json("perspectives/query", {**query, "text": "bench"})
        self.assertEqual(searched["matchIds"], [self.ids["A18"], self.ids["A26"]])
        self.assertEqual(searched["focusIds"], [self.ids["P06"]])
        self.assertEqual(self.child_ids(self.ids["P06"]), initial_order)

        membership.delete()
        self.post_json("perspectives/commands", request, status=404)
        self.post_json("perspectives/query", query, status=404)
