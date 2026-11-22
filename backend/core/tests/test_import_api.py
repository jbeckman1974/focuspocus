from copy import deepcopy
from uuid import uuid4

from django.db import transaction
from django.test import TestCase

from core.content.models import ItemNote
from core.imports.models import ImportBatch, ImportMapping
from core.imports.portable import export_batches, restore_batches
from core.models import Item, ItemTag, Membership, Tag
from core.repeats.models import Occurrence
from core.tests.outline_case import OutlineApiMixin


class SourceImportTests(OutlineApiMixin, TestCase):
    fixture = ("ID,Parent ID,Type,Name,Tags,Note,Due,Repeat Rule\n"
               'p,,Project,Desk,,,,""\n'
               'a,p,Task,Café,Field,"First paragraph, β\nnext paragraph",2026-11-22,FREQ=WEEKLY;COUNT=4\n')

    def stage(self, raw=None, fmt="csv", status=200):
        data = self.fixture.encode("utf-16") if raw is None else raw
        response = self.client.post(self.base + "imports/?format=" + fmt, data, content_type="application/octet-stream")
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def body(self):
        self.space.refresh_from_db()
        return {"context": self.context, "operationId": str(uuid4()), "expectedRevision": self.space.revision}

    def change(self, batch, action, body=None, status=200):
        response = self.client.post(self.base + f"imports/{batch['id']}/{action}", body or self.body(),
                                    content_type="application/json")
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def test_preview_abort_and_invalid_source_do_not_change_outline(self):
        preview = self.stage()
        self.assertTrue(preview["canCommit"])
        self.assertEqual(preview["id"], self.stage()["id"])
        self.assertEqual(self.change(preview, "abort")["status"], "aborted")
        self.assertFalse(Item.objects.exists())
        self.assertFalse(Tag.objects.exists())
        bad = self.stage(b"ID,Name\n1,one\n1,two\n")
        self.assertFalse(bad["canCommit"])
        self.change(bad, "commit", status=409)
        self.assertEqual(self.space.revision, 0)

    def test_retry_source_ids_repeat_and_clean_rollback(self):
        staged = self.stage()
        body = self.body()
        self.change(staged, "commit", body)
        self.assertEqual(self.change(staged, "commit", body)["status"], "committed")
        self.assertEqual(self.stage()["id"], staged["id"])
        project = Item.objects.get(kind="project")
        action = Item.objects.get(kind="action")
        self.assertEqual(action.parent_id, project.pk)
        self.assertEqual(action.tags.get().title, "Field")
        self.assertEqual(ItemNote.objects.get(item=action).plain_text, "First paragraph, β\nnext paragraph")
        self.assertEqual(Occurrence.objects.get(item=action).series.remaining, 4)
        changed_file = self.stage(self.fixture.replace("Café", "Other title").encode())
        self.assertEqual({r["state"] for r in changed_file["rows"]}, {"existing"})
        self.change(changed_file, "commit")
        action.refresh_from_db()
        self.assertEqual(action.title, "Café")
        rollback = self.body()
        self.change(staged, "rollback", rollback)
        self.assertEqual(self.change(staged, "rollback", rollback)["status"], "rolled_back")
        self.assertFalse(Item.objects.exists())
        self.assertFalse(Tag.objects.exists())
        self.assertFalse(Occurrence.objects.exists())
        self.assertFalse(ImportMapping.objects.filter(active=True).exists())

    def test_revalidates_access_and_workspace_revision_on_every_step(self):
        staged = self.stage()
        earlier = self.body()
        self.capture(["Outside"])
        self.change(staged, "commit", earlier, 409)
        body = self.body()
        self.change(staged, "commit", body)
        membership = Membership.objects.get(workspace=self.space, user=self.owner)
        for role in ("editor", "viewer"):
            membership.role = role
            membership.save()
            self.change(staged, "commit", body, 403)
            self.stage(status=403)
            self.assertEqual(self.client.get(self.base + "imports/" + staged["id"]).status_code, 403)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.base + "imports/" + staged["id"]).status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/workspaces/{self.foreign.pk}/imports/{staged['id']}").status_code, 404)

    def test_intervening_edit_and_new_child_keep_entire_batch(self):
        preview = self.stage(b"Project:\n\t- Action @tags(Field)", fmt="taskpaper")
        self.change(preview, "commit")
        project = Item.objects.get(kind="project")
        action = Item.objects.get(kind="action")
        self.command("bulk-edit", {"ids": [str(action.pk)], "title": "Kept"})
        outside = self.capture(["Later child"], str(project.pk))[0]
        conflict = self.change(preview, "rollback", status=409)
        self.assertIn(str(action.pk), [c.get("itemId") for c in conflict["conflicts"]])
        self.assertEqual(Item.objects.get(pk=outside).parent, project)
        self.assertEqual(Item.objects.count(), 3)
        self.assertTrue(ImportBatch.objects.get(pk=preview["id"]).conflicts)

    def test_external_tag_reference_blocks_rollback_without_tag_version_change(self):
        outside = self.capture(["Neighbor"])[0]
        staged = self.stage(b"- Keep @tags(New)", fmt="taskpaper")
        self.change(staged, "commit")
        tag = Tag.objects.get()
        ItemTag.objects.create(workspace=self.space, item_id=outside, tag=tag)
        conflict = self.change(staged, "rollback", status=409)
        self.assertTrue(any("tag" in c["reason"] for c in conflict["conflicts"]))
        self.assertEqual(ItemTag.objects.filter(tag=tag).count(), 2)

    def test_portable_history_dedupes_and_can_roll_back_with_remapped_ids(self):
        batch = self.stage(b"ID,Name,Tags\nknown,Portable,Field\n")
        self.change(batch, "commit")
        archived = export_batches(self.space)
        item, tag = Item.objects.get(workspace=self.space), Tag.objects.get(workspace=self.space)
        replica = Item.objects.create(workspace=self.foreign, kind=item.kind, title=item.title, position=item.position)
        new_tag = Tag.objects.create(workspace=self.foreign, title=tag.title)
        ItemTag.objects.create(workspace=self.foreign, tag=new_tag, item=replica)
        items, tags = {str(item.pk): replica.pk}, {str(tag.pk): new_tag.pk}
        broken = deepcopy(archived)
        broken[0]["mappings"][0]["sourceId"] = "tampered"
        with self.assertRaises(ValueError), transaction.atomic():
            restore_batches(self.foreign, broken, items, tags)
        self.assertFalse(ImportBatch.objects.filter(workspace=self.foreign).exists())
        restore_batches(self.foreign, archived, items, tags)
        from core.commands.context import issue_context
        self.client.force_login(self.other)
        self.space, self.context = self.foreign, issue_context(self.foreign, self.other)
        self.base = f"/api/v1/workspaces/{self.space.pk}/"
        same = self.stage(b"ID,Name,Tags\nknown,Portable,Field\n")
        self.assertEqual(same["status"], "committed")
        self.change(same, "rollback")
        self.assertFalse(Item.objects.filter(workspace=self.foreign).exists())
        self.assertTrue(Item.objects.filter(pk=item.pk).exists())
