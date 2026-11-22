"""Authenticated API helpers shared by the documented reference-workspace scenarios."""

from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase

from core.models import Item, Membership, Workspace
from core.tests.reference_outline import seed_outline


class ReferenceWorkspaceCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        user_model = get_user_model()
        cls.owner = user_model.objects.create_user(username="reference-owner")
        cls.space = Workspace.objects.create(private_owner=cls.owner)
        Membership.objects.create(workspace=cls.space, user=cls.owner, role="owner")
        cls.ids = seed_outline(cls.space)
        neighbor = user_model.objects.create_user(username="reference-neighbor")
        foreign = Workspace.objects.create(private_owner=neighbor)
        Membership.objects.create(workspace=foreign, user=neighbor, role="owner")
        cls.private_id = str(Item.objects.create(
            workspace=foreign, title="B private marker", position=1024, kind="action",
        ).pk)

    def setUp(self):
        self.client.force_login(self.owner)
        self.base = f"/api/v1/workspaces/{self.space.pk}/"

    def read(self, route, **params):
        response = self.client.get(self.base + route, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def send(self, name, payload, status=200):
        snapshot = self.read("snapshot")
        response = self.client.post(self.base + "commands/" + name, {
            "context": snapshot["context"], "operationId": str(uuid4()),
            "expectedRevision": snapshot["revision"], "payload": payload,
        }, content_type="application/json")
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def child_ids(self, group_id):
        snapshot = self.read("snapshot")
        return [item["id"] for item in snapshot["tasks"] if item["parentId"] == group_id]
