import uuid
from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import OperationalError
from django.test import Client, TestCase

from core.models import Change, Item, ItemTag, Membership, Tag, Workspace
from core.sync import feed


class FeedTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user(username="owner-fixture")
        cls.space = Workspace.objects.create(private_owner=cls.owner)
        Membership.objects.create(workspace=cls.space, user=cls.owner, role="owner")
        cls.foreign = get_user_model().objects.create_user(username="other-fixture")
        cls.foreign_space = Workspace.objects.create(private_owner=cls.foreign)
        Membership.objects.create(workspace=cls.foreign_space, user=cls.foreign, role="owner")
        cls.base = f"/api/v1/workspaces/{cls.space.pk}/"

    def setUp(self):
        self.client.force_login(self.owner)

    def test_snapshot_serializes_order_identity_and_direct_fields(self):
        project = Item.objects.create(workspace=self.space, kind="project", title="Sample", position=2)
        group = Item.objects.create(workspace=self.space, parent=project, kind="group", title="Kit", position=8)
        child = Item.objects.create(
            workspace=self.space, parent=group, kind="action", title="Cable", position=4,
            due=date(2026, 11, 26), version=3, done=True,
        )
        inbox = Item.objects.create(workspace=self.space, kind="action", title="Note", position=1)
        tag = Tag.objects.create(workspace=self.space, title="Field")
        ItemTag.objects.create(workspace=self.space, tag=tag, item=child)
        Item.objects.create(workspace=self.foreign_space, kind="action", title="Other", position=0)
        response = self.client.get(self.base + "snapshot")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        data = response.json()
        self.assertEqual(data["workspaceId"], str(self.space.pk))
        self.assertEqual(len(data["projects"]), 1)
        project_row = data["projects"][0]
        self.assertEqual([project_row[key] for key in ("id", "title", "version")], [str(project.pk), "Sample", 1])
        self.assertEqual(data["tags"][0]["id"], str(tag.pk))
        self.assertEqual([task["id"] for task in data["tasks"]], [str(x.pk) for x in (inbox, child, group)])
        self.assertEqual(data["tasks"][0]["parentId"], "inbox")
        required = {
            "id": str(child.pk), "title": "Cable", "version": 3, "kind": "action",
            "parentId": str(group.pk), "tags": [str(tag.pk)], "due": "2026-11-26", "done": True,
        }
        self.assertEqual({key: data["tasks"][1][key] for key in required}, required)
        self.assertEqual(self.client.get(self.base + "changes", {"after": data["cursor"]}).json()["changes"], [])

    def test_cursor_scope_unavailable_window_and_revoked_membership(self):
        token = self.client.get(self.base + "snapshot").json()["cursor"]
        self.client.force_login(self.foreign)
        missing = self.client.get(f"/api/v1/workspaces/{uuid.uuid4()}/snapshot")
        denied = self.client.get(self.base + "snapshot")
        self.assertEqual((missing.status_code, missing.json()), (denied.status_code, denied.json()))
        self.assertEqual(denied.status_code, 404)
        other = f"/api/v1/workspaces/{self.foreign_space.pk}/changes"
        self.assertEqual(self.client.get(other, {"after": token}).status_code, 410)
        self.client.force_login(self.owner)
        rotated = uuid.uuid4()
        Workspace.objects.filter(pk=self.space.pk).update(generation=rotated)
        response = self.client.get(self.base + "changes", {"after": token})
        self.assertEqual((response.status_code, response.json()), (410, {"error": "snapshot_required"}))
        Membership.objects.filter(user=self.owner).delete()
        self.assertEqual(self.client.get(self.base + "changes", {"after": token}).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.base + "snapshot").status_code, 401)

    def test_cursor_expiry_damaged_input_and_newer_revision_than_database(self):
        with patch("django.core.signing.time.time", return_value=1):
            expired = feed.cursor_for(self.space, self.owner, 0)
        future = feed.cursor_for(self.space, self.owner, 1)
        for cursor in [expired, future, "", "invalid"]:
            with self.subTest(cursor_kind=len(cursor)):
                self.assertEqual(self.client.get(self.base + "changes", {"after": cursor}).status_code, 410)
        for limit in [0, -1, 101, "bad"]:
            self.assertEqual(self.client.get(self.base + "changes", {"limit": limit}).status_code, 400)

    def test_bounded_pages_stay_contiguous_as_activity_arrives(self):
        cursor = self.client.get(self.base + "snapshot").json()["cursor"]
        for i in range(1, 4):
            Change.objects.create(workspace=self.space, revision=i, affected=[str(uuid.uuid4())])
        Workspace.objects.filter(pk=self.space.pk).update(revision=3)
        first = self.client.get(self.base + "changes", {"after": cursor, "limit": 2}).json()
        self.assertEqual([row["revision"] for row in first["changes"]], [1, 2])
        self.assertEqual(first["revision"], 2)
        self.assertTrue(first["more"])
        Change.objects.create(workspace=self.space, revision=4, affected=[])
        Workspace.objects.filter(pk=self.space.pk).update(revision=4)
        second = self.client.get(self.base + "changes", {"after": first["cursor"], "limit": 2}).json()
        self.assertEqual([row["revision"] for row in second["changes"]], [3, 4])
        self.assertFalse(second["more"])
        Change.objects.filter(workspace=self.space, revision=3).delete()
        self.assertEqual(self.client.get(self.base + "changes", {"after": first["cursor"]}).status_code, 410)

    def test_health_returns_only_status_and_readiness_requires_database(self):
        anonymous = Client()
        self.assertEqual(anonymous.get("/api/v1/health/live").json(), {"status": "live"})
        self.assertEqual(anonymous.get("/api/v1/health/ready").json(), {"status": "ready"})
        with patch("core.sync.views.schema_ready", side_effect=OperationalError):
            unready = anonymous.get("/api/v1/health/ready")
        self.assertEqual((unready.status_code, unready.json()), (503, {"status": "unavailable"}))

    def test_two_sessions_see_the_same_committed_task_after_reconnect(self):
        second = Client()
        second.force_login(self.owner)
        before = second.get(self.base + "snapshot").json()
        initial = self.client.get(self.base + "snapshot").json()
        new_id = str(uuid.uuid4())
        envelope = {
            "context": initial["context"], "operationId": str(uuid.uuid4()),
            "expectedRevision": initial["revision"],
            "payload": {"parentId": "inbox", "items": [{"id": new_id, "title": "Bench kit"}]},
        }
        url = self.base + "commands/capture"
        committed = self.client.post(url, envelope, content_type="application/json")
        self.assertEqual(committed.status_code, 200, committed.content)
        again = self.client.post(url, envelope, content_type="application/json")
        self.assertEqual(again.json(), committed.json())
        catch_up = second.get(self.base + "changes", {"after": before["cursor"]}).json()
        self.assertEqual([row["revision"] for row in catch_up["changes"]], [before["revision"] + 1])
        self.assertIn(new_id, catch_up["changes"][0]["affected"])
        after = second.get(self.base + "snapshot").json()
        self.assertEqual(after["revision"], catch_up["revision"])
        self.assertEqual([task["id"] for task in after["tasks"]], [new_id])
        self.assertEqual(second.get(self.base + "changes", {"after": catch_up["cursor"]}).json()["changes"], [])
