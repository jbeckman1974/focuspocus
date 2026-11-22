from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase

from core.commands.context import issue_context
from core.models import Change, Item, Membership, Receipt, Workspace


class OutlineApiTests(TestCase):
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

    def test_move_tag_date_complete_and_compensate(self):
        project, tag = str(uuid4()), str(uuid4())
        self.command("create-container", {"id": project, "title": "Punch list"})
        self.command("create-tag", {"id": tag, "title": "Field"})
        group, cable, book = self.capture(["Bench kit", "Cable roll", "Field book"])
        self.command("indent", {"ids": [book, cable]})
        self.assertEqual(Item.objects.get(pk=group).kind, "group")
        self.command("set-tags", {"ids": [cable, book], "tagId": tag, "enabled": True})
        self.command("bulk-edit", {"ids": [book], "due": "2028-02-29"})
        self.command("move", {"ids": [group, cable], "parentId": project})
        descendants = Item.objects.filter(parent_id=group).order_by("position")
        self.assertEqual([str(item.pk) for item in descendants], [cable, book])
        detail = self.client.get(self.base + "items/" + book)
        self.assertEqual(detail.json()["tags"], [tag])
        self.assertEqual(detail.json()["due"], "2028-02-29")
        receipt = self.command("complete", {"ids": [book]})
        self.assertTrue(receipt["undoable"])
        undo = {"operationId": receipt["operationId"], "contextId": receipt["contextId"]}
        self.command("undo", undo)
        self.assertFalse(Item.objects.get(pk=book).done)
        self.command("undo", undo, 409)
        later = self.command("complete", {"ids": [book]})
        self.command("bulk-edit", {"ids": [book], "title": "Newer title"})
        self.command("undo", {"operationId": later["operationId"], "contextId": later["contextId"]}, 409)
        self.assertTrue(Item.objects.get(pk=book).done)

    def test_group_and_reorder_follow_manual_order(self):
        first, second, third, last = self.capture(["First", "Second", "Third", "Last"])
        group = str(uuid4())
        self.command("group", {"ids": [third, second], "id": group, "title": "Pair"})
        self.command("reorder", {"parentId": group, "ids": [third], "beforeId": second})
        self.command("outdent", {"ids": [second]})
        self.assertEqual(
            [str(pk) for pk in Item.objects.filter(parent=None).order_by("position").values_list("pk", flat=True)],
            [first, group, second, last],
        )
        self.assertEqual(str(Item.objects.get(pk=third).parent_id), group)

    def test_replay_precedes_version_check_and_permission_precedes_replay(self):
        item = str(uuid4())
        envelope = self.envelope({"parentId": "inbox", "items": [{"id": item, "title": "Once"}]})
        accepted = self.send("capture", envelope)
        self.assertEqual(accepted.status_code, 200)
        self.command("bulk-edit", {"ids": [item], "title": "New title"})
        self.assertEqual(self.send("capture", envelope).json(), accepted.json())
        self.assertEqual(Change.objects.filter(workspace=self.space).count(), 2)
        modified = {**envelope, "payload": {"parentId": "inbox", "items": [{"id": item, "title": "Changed"}]}}
        self.assertEqual(self.send("capture", modified).status_code, 409)
        membership = Membership.objects.get(workspace=self.space, user=self.owner)
        membership.role = "viewer"
        membership.save(update_fields=["role"])
        self.assertEqual(self.send("capture", envelope).status_code, 403)
        membership.delete()
        self.assertEqual(self.send("capture", envelope).status_code, 404)
        self.client.logout()
        self.assertEqual(self.send("capture", envelope).status_code, 401)

    def test_read_and_write_foreign_ids_match_absent_and_batch_rollback(self):
        own = self.capture(["Own"])[0]
        foreign = Item.objects.create(workspace=self.foreign, kind="action", title="B private", position=100)
        before = self.client.get(self.base + "items/" + own).json()
        for item_id in [str(foreign.pk), str(uuid4())]:
            detail = self.client.get(self.base + "items/" + item_id)
            self.assertEqual(detail.status_code, 404)
            self.assertEqual(detail.json(), {"error": "Item unavailable."})
            self.command("bulk-edit", {"ids": [own, item_id], "title": "Different"}, 404)
        self.assertEqual(self.client.get(self.base + "items/" + own).json(), before)
        self.command("move", {"ids": [own], "parentId": str(foreign.pk)}, 404)
        self.assertEqual(Receipt.objects.filter(workspace=self.space).count(), 1)

    def test_direct_etag_conflict_exact_retry_and_version_guard(self):
        item = self.capture(["Keep me"])[0]
        url = self.base + "items/" + item
        etag = self.client.get(url)["ETag"]
        envelope = self.envelope({"title": "Change"})
        first = self.client.patch(url, envelope, content_type="application/json", HTTP_IF_MATCH=etag)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(self.client.patch(
            url, envelope, content_type="application/json", HTTP_IF_MATCH=etag
        ).json(), first.json())
        fresh = self.envelope({"title": "Stale"})
        self.assertEqual(self.client.patch(url, fresh, content_type="application/json", HTTP_IF_MATCH=etag).status_code, 412)
        self.assertEqual(self.client.patch(url, fresh, content_type="application/json").status_code, 428)
        stale = self.envelope({"ids": [item], "title": "Stale"}, expectedRevision=0)
        self.assertEqual(self.send("bulk-edit", stale).status_code, 409)
        self.assertEqual(Item.objects.get(pk=item).title, "Change")

    def test_context_binding_expiry_and_restore_invalidate_even_receipt_replay(self):
        body = self.envelope({"items": [{"id": str(uuid4()), "title": "Original"}], "parentId": "inbox"})
        self.assertEqual(self.send("capture", body).status_code, 200)
        for token in [issue_context(self.space, self.other), issue_context(self.foreign, self.owner), "invalid"]:
            self.assertEqual(self.send("capture", {**body, "context": token}).status_code, 410)
        from unittest.mock import patch
        with patch("core.commands.context.MAX_AGE_SECONDS", -1):
            self.assertEqual(self.send("capture", body).status_code, 410)
        self.space.generation = uuid4()
        self.space.save(update_fields=["generation"])
        self.assertEqual(self.send("capture", body).status_code, 410)
        self.assertEqual(Item.objects.filter(workspace=self.space).count(), 1)

    def test_invalid_hierarchy_and_creation_collision_roll_back(self):
        group, child = self.capture(["Group", "Child"])
        self.command("indent", {"ids": [child]})
        nested = str(uuid4())
        self.command("group", {"id": nested, "title": "Nested", "ids": [child]})
        self.command("move", {"ids": [group], "parentId": nested}, 422)
        self.command("capture", {"parentId": child, "items": [{"id": str(uuid4()), "title": "Bad"}]}, 422)
        fresh = str(uuid4())
        self.command("capture", {"parentId": "inbox", "items": [
            {"id": fresh, "title": "First"}, {"id": child, "title": "Conflict"}
        ]}, 409)
        self.assertFalse(Item.objects.filter(pk=fresh).exists())
        no_version = self.envelope({"ids": [group]})
        del no_version["expectedRevision"]
        self.assertEqual(self.send("complete", no_version).status_code, 428)
