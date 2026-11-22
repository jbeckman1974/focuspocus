from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from core.commands.context import issue_context
from core.models import Change, Item, Membership, Receipt, Workspace
from core.sharing.models import CaptureCredential, SharedWorkspace


class CaptureAdapterTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.actor = users.create_user(username="capture-device-owner")
        self.owner = users.create_user(username="shared-owner")
        self.space = Workspace.objects.create()
        SharedWorkspace.objects.create(workspace=self.space, name="Office")
        Membership.objects.create(user=self.actor, workspace=self.space, role="editor")
        Membership.objects.create(user=self.owner, workspace=self.space, role="owner")
        self.client.force_login(self.actor)
        self.base = f"/api/v1/workspaces/{self.space.pk}/sharing/"
        self.pin = {"HTTP_X_FOCUSPOCUS_ACTOR": str(self.actor.pk)}
        self.bearer = Client(enforce_csrf_checks=True)
        self.grant = self.post(self.client, self.base + "credentials", {"label": "Field device"}, self.pin)
        self.auth = {"HTTP_AUTHORIZATION": "Bearer " + self.grant["token"]}
        self.context = self.post(self.bearer, "/api/v1/capture/context", {}, self.auth)["context"]
        self.request = {"operationId": str(uuid4()), "title": "Check field notes", "context": self.context}

    def post(self, client, path, data, auth, status=200):
        response = client.post(path, data, content_type="application/json", **auth)
        self.assertEqual(response.status_code, status, response.content[:150])
        return response.json()

    def test_capture_only_creates_one_inbox_item_and_never_discloses_workspace_data(self):
        credential = CaptureCredential.objects.get(pk=self.grant["id"])
        self.assertNotEqual(credential.digest, self.grant["token"])
        self.post(self.client, self.base + "credentials", {"label": self.grant["label"]}, self.pin, 409)
        self.assertEqual(CaptureCredential.objects.count(), 1)
        self.assertNotIn(self.grant["token"], self.client.get(self.base + "credentials", **self.pin).content.decode())
        first = self.post(self.bearer, "/api/v1/capture", self.request, self.auth)
        self.assertEqual(set(first), {"operationId", "itemId"})
        self.assertEqual(first["operationId"], self.request["operationId"])
        refreshed = self.post(self.bearer, "/api/v1/capture/context", {}, self.auth)["context"]
        self.assertEqual(first, self.post(self.bearer, "/api/v1/capture", {**self.request, "context": refreshed}, self.auth))
        self.post(self.bearer, "/api/v1/capture", {**self.request, "title": "Different payload"}, self.auth, 409)
        self.post(self.bearer, "/api/v1/capture", {**self.request, "workspaceId": str(uuid4())}, self.auth, 422)
        item = Item.objects.get()
        self.assertEqual((str(item.pk), item.workspace_id, item.parent_id, item.title),
                         (first["itemId"], self.space.pk, None, "Check field notes"))
        self.assertEqual(Change.objects.count(), 1)
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(self.bearer.get(f"/api/v1/workspaces/{self.space.pk}/snapshot", **self.auth).status_code, 401)
        self.assertEqual(self.bearer.get(self.base + "credentials", **self.auth).status_code, 401)
        self.assertEqual(self.bearer.get("/api/v1/session", **self.auth).json()["workspaces"], [])

    def test_context_is_bound_to_credential_generation_and_capture_audience(self):
        other = self.post(self.client, self.base + "credentials", {"label": "Second device"}, self.pin)
        auth = {"HTTP_AUTHORIZATION": "Bearer " + other["token"]}
        self.post(self.bearer, "/api/v1/capture", self.request, auth, 410)
        browser_context = issue_context(self.space, self.actor)
        self.post(self.bearer, "/api/v1/capture", {**self.request, "context": browser_context}, self.auth, 410)
        self.post(self.client, "/api/v1/capture/context", {}, {}, 401)
        Workspace.objects.filter(pk=self.space.pk).update(generation=uuid4())
        self.post(self.bearer, "/api/v1/capture/context", {}, self.auth, 401)
        self.post(self.bearer, "/api/v1/capture", self.request, self.auth, 401)
        self.assertFalse(Item.objects.exists())

    def test_revoked_credentials_or_removed_write_role_cannot_replay_and_do_not_revive(self):
        self.post(self.bearer, "/api/v1/capture", self.request, self.auth)
        self.post(self.client, self.base + f"credentials/{self.grant['id']}/revoke", {}, self.pin)
        self.post(self.bearer, "/api/v1/capture", self.request, self.auth, 401)
        new = self.post(self.client, self.base + "credentials", {"label": "New device"}, self.pin)
        auth = {"HTTP_AUTHORIZATION": "Bearer " + new["token"]}
        self.client.force_login(self.owner)
        pin = {"HTTP_X_FOCUSPOCUS_ACTOR": str(self.owner.pk)}
        self.post(self.client, self.base + f"credentials/{new['id']}/revoke", {}, pin, 404)
        role_path = self.base + f"members/{self.actor.pk}"
        self.post(self.client, role_path, {"expectedVersion": 0, "role": "viewer"}, pin)
        self.post(self.bearer, "/api/v1/capture/context", {}, auth, 401)
        self.client.force_login(self.actor)
        self.post(self.client, self.base + "credentials", {"label": "Denied"}, self.pin, 403)
        self.client.force_login(self.owner)
        self.post(self.client, role_path, {"expectedVersion": 1, "role": "editor"}, pin)
        self.post(self.bearer, "/api/v1/capture/context", {}, auth, 401)
        self.assertEqual(Item.objects.count(), 1)
