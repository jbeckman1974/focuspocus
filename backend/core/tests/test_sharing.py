from datetime import timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from core.models import Change, Membership, Workspace
from core.sharing.models import WorkspaceInvitation


class SharingTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.owner = users.create_user(username="workspace-owner")
        self.member = users.create_user(username="field-editor")
        self.other = users.create_user(username="different-account", is_staff=True, is_superuser=True)
        self.private = Workspace.objects.create(private_owner=self.owner)
        Membership.objects.create(workspace=self.private, user=self.owner, role="owner")
        self.api = "/api/v1/"
        self.act(self.owner)
        self.shared = str(uuid4())
        self.create = {"id": self.shared, "name": "Field office"}
        self.post("sharing/workspaces", self.create)
        self.roster = f"workspaces/{self.shared}/sharing/"

    def act(self, actor):
        self.client.force_login(actor)
        self.actor = {"HTTP_X_FOCUSPOCUS_ACTOR": str(actor.pk)}

    def post(self, path, data, status=200):
        result = self.client.post(self.api + path, data, content_type="application/json", **self.actor)
        self.assertEqual(result.status_code, status, result.content[:300])
        return result.json()

    def get(self, path, status=200):
        result = self.client.get(self.api + path, **self.actor)
        self.assertEqual(result.status_code, status, result.content[:300])
        return result.json()

    def invite(self, version=0, role="editor"):
        return self.post(self.roster + "invites", {"username": self.member.username, "role": role,
                                                  "expectedVersion": version})

    def test_shared_workspace_creation_is_retryable_and_private_workspace_cannot_be_opened(self):
        self.assertEqual(self.post("sharing/workspaces", self.create)["workspaceId"], self.shared)
        self.post("sharing/workspaces", {**self.create, "name": "Other name"}, 409)
        choices = self.get("sharing/workspaces")["workspaces"]
        self.assertEqual([entry["id"] for entry in choices], [str(self.private.pk), self.shared])
        self.assertEqual([entry["private"] for entry in choices], [True, False])
        self.post(f"workspaces/{self.private.pk}/sharing/invites",
                  {"username": self.member.username, "role": "editor", "expectedVersion": 0}, 403)
        self.act(self.other)
        self.assertEqual(self.get("sharing/workspaces"), {"workspaces": []})
        self.get(self.roster, 404)
        self.post("sharing/workspaces", self.create, 409)
        self.assertFalse(Membership.objects.filter(workspace=self.private, user=self.member).exists())

    def test_invitation_is_targeted_expiring_single_use_and_owner_only(self):
        first = self.invite()
        self.assertNotIn(first["token"], str(self.get(self.roster)))
        self.assertNotEqual(WorkspaceInvitation.objects.get(pk=first["id"]).digest, first["token"])
        self.act(self.other)
        self.post("sharing/accept", {"token": first["token"]}, 404)
        self.act(self.member)
        self.get(self.roster, 404)
        WorkspaceInvitation.objects.filter(pk=first["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.post("sharing/accept", {"token": first["token"]}, 404)
        self.act(self.owner)
        second = self.invite(1, "viewer")
        third = self.invite(2)
        self.post(self.roster + f"invites/{second['id']}/revoke", {"expectedVersion": 3}, 404)
        self.post(self.roster + f"invites/{third['id']}/revoke", {"expectedVersion": 3})
        self.act(self.member)
        self.post("sharing/accept", {"token": second["token"]}, 404)
        self.post("sharing/accept", {"token": third["token"]}, 404)
        self.act(self.owner)
        invitation = self.invite(4, "viewer")
        self.act(self.member)
        self.assertEqual(self.post("sharing/accept", {"token": invitation["token"]}),
                         {"workspaceId": self.shared, "role": "viewer"})
        self.post("sharing/accept", {"token": invitation["token"]}, 404)
        listing = self.get(self.roster)
        self.assertEqual((listing["version"], listing["role"], listing["members"]), (6, "viewer", []))
        self.post(self.roster + "invites", {"username": self.other.username, "role": "editor", "expectedVersion": 6}, 403)
        self.act(self.owner)
        self.assertEqual({m["userId"] for m in self.get(self.roster)["members"]}, {self.owner.pk, self.member.pk})

    def test_role_changes_notify_other_sessions_and_immediately_remove_access(self):
        invite = self.invite()
        self.act(self.member)
        self.post("sharing/accept", {"token": invite["token"]})
        base = f"workspaces/{self.shared}/"
        snapshot = self.get(base + "snapshot")
        job = {"context": snapshot["context"], "operationId": str(uuid4()), "expectedRevision": snapshot["revision"],
               "payload": {"parentId": "inbox", "items": [{"id": str(uuid4()), "title": "Survey team task"}]}}
        self.post(base + "commands/capture", job)
        self.act(self.owner)
        modify = self.roster + f"members/{self.member.pk}"
        self.post(modify, {"role": "viewer", "expectedVersion": 0}, 409)
        self.post(self.roster + f"members/{self.owner.pk}", {"role": None, "expectedVersion": 2}, 403)
        self.post(modify, {"role": "viewer", "expectedVersion": 2})
        self.act(self.member)
        self.post(base + "commands/capture", job, 403)
        read = self.get(base + "snapshot")
        self.assertEqual(read["tasks"][0]["title"], "Survey team task")
        self.act(self.owner)
        self.post(modify, {"role": None, "expectedVersion": 3})
        self.act(self.member)
        self.get(base + "snapshot", 404)
        self.get(self.roster, 404)
        self.assertEqual(self.get("sharing/workspaces"), {"workspaces": []})
        response = self.client.get(self.api + base + "changes", {"after": read["cursor"]}, **self.actor)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Change.objects.filter(workspace_id=self.shared).count(), 4)

    def test_session_mutations_require_csrf_and_all_sharing_routes_pin_the_actor(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.owner)
        self.assertEqual(client.get(self.api + "sharing/workspaces").status_code, 403)
        self.assertEqual(client.get(self.api + "sharing/workspaces", HTTP_X_FOCUSPOCUS_ACTOR=str(self.member.pk)).status_code, 403)
        self.assertEqual(client.post(self.api + "sharing/workspaces", self.create,
                                     content_type="application/json", **self.actor).status_code, 403)
        client.logout()
        self.assertEqual(client.get(self.api + self.roster, **self.actor).status_code, 401)

    def test_restore_generation_fences_existing_invitation(self):
        invite = self.invite()
        Workspace.objects.filter(pk=self.shared).update(generation=uuid4())
        self.act(self.member)
        self.post("sharing/accept", {"token": invite["token"]}, 404)

    def test_editor_changes_order_dates_status_tags_flags_and_review_for_the_owner(self):
        invite = self.invite()
        self.act(self.member)
        self.post("sharing/accept", {"token": invite["token"]})
        base = f"workspaces/{self.shared}/"

        def command(name, payload):
            snapshot = self.get(base + "snapshot")
            return self.post(base + "commands/" + name, {
                "operationId": str(uuid4()), "context": snapshot["context"],
                "expectedRevision": snapshot["revision"], "payload": payload,
            })

        project, first, second, tag = [str(uuid4()) for _ in range(4)]
        command("create-container", {"id": project, "title": "Field review", "kind": "project"})
        command("capture", {"parentId": project, "items": [{"id": first, "title": "Schedule visit"},
                                                          {"id": second, "title": "Review notes"}]})
        command("create-tag", {"id": tag, "title": "Field"})
        command("set-tags", {"ids": [second], "tagId": tag, "enabled": True})
        command("set-properties", {"ids": [second], "flagged": True})
        command("bulk-edit", {"ids": [second], "due": "2028-02-29"})
        command("reorder", {"ids": [second], "parentId": project, "beforeId": first})
        command("complete", {"ids": [second]})
        command("set-review", {"projectId": project, "interval": 3, "unit": "day"})
        command("mark-reviewed", {"projectId": project})
        self.act(self.owner)
        snapshot = self.get(base + "snapshot")
        tasks = sorted(snapshot["tasks"], key=lambda row: row["position"])
        self.assertEqual([row["id"] for row in tasks], [second, first])
        task = tasks[0]
        self.assertEqual((task["done"], task["due"], task["flagged"], task["tags"]), (True, "2028-02-29", True, [tag]))
        review = self.get(base + "planning/review?scope=all")["projects"][0]
        self.assertEqual((review["projectId"], review["interval"], review["unit"], review["lastReviewedBy"]),
                         (project, 3, "day", str(self.member.pk)))
