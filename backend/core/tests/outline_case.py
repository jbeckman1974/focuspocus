"""Create two private workspaces and drive the authenticated command envelope."""

from uuid import uuid4

from django.contrib.auth import get_user_model

from core.commands.context import issue_context
from core.models import Membership, Workspace


class OutlineApiMixin:
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username="test-outline-owner")
        self.other = get_user_model().objects.create_user(username="test-outline-other")
        self.space = Workspace.objects.create(private_owner=self.owner)
        self.foreign = Workspace.objects.create(private_owner=self.other)
        Membership.objects.create(workspace=self.space, user=self.owner, role="owner")
        Membership.objects.create(workspace=self.foreign, user=self.other, role="owner")
        self.client.force_login(self.owner)
        self.base = f"/api/v1/workspaces/{self.space.pk}/"
        self.context = issue_context(self.space, self.owner)

    def envelope(self, payload, **extra):
        self.space.refresh_from_db()
        return {
            "context": self.context, "operationId": str(uuid4()),
            "expectedRevision": self.space.revision, "payload": payload, **extra,
        }

    def send(self, name, body):
        return self.client.post(self.base + "commands/" + name, body, content_type="application/json")

    def command(self, name, payload, status=200):
        response = self.send(name, self.envelope(payload))
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def capture(self, titles, parent="inbox"):
        rows = [{"id": str(uuid4()), "title": title} for title in titles]
        return self.command("capture", {"parentId": parent, "items": rows})["selection"]
