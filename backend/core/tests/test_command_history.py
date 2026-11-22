from uuid import uuid4

from django.test import TestCase

from core.commands.context import issue_context
from core.models import Item, ItemTag, Workspace

from .outline_case import OutlineApiMixin


def reference(receipt):
    return {key: receipt[key] for key in ("operationId", "contextId")}


class CommandHistoryTests(OutlineApiMixin, TestCase):
    def test_adjacent_undos_and_redos_retain_ids_and_advance_revisions(self):
        item = str(uuid4())
        capture = self.command("capture", {"parentId": "inbox", "items": [{"id": item, "title": "First"}]})
        rename = self.command("bulk-edit", {"ids": [item], "title": "Second"})
        undo_name = self.command("undo", reference(rename))
        self.assertEqual(Item.objects.get(pk=item).title, "First")
        undo_capture = self.command("undo", reference(capture))
        self.assertFalse(Item.objects.filter(pk=item).exists())
        redo_capture = self.command("redo", reference(undo_capture))
        self.assertEqual(Item.objects.get(pk=item).title, "First")
        redo_name = self.command("redo", reference(undo_name))
        restored = Item.objects.get(pk=item)
        self.assertEqual(restored.title, "Second")
        self.assertGreater(restored.version, rename["versions"][item])
        self.assertGreater(redo_name["revision"], redo_capture["revision"])
        self.command("undo", reference(redo_name))
        self.assertEqual(Item.objects.get(pk=item).title, "First")

    def test_inverse_guard_protects_incoming_child_and_another_workspace(self):
        project = str(uuid4())
        creation = self.command("create-container", {"id": project, "title": "Survey"})
        # An out-of-band child simulates a new integration missing the workspace protocol.
        Item.objects.create(workspace=self.space, parent_id=project, kind="action", title="Retain", position=1024)
        self.command("undo", reference(creation), 409)
        self.assertEqual(Item.objects.get(parent_id=project).title, "Retain")
        self.client.force_login(self.other)
        envelope = {"context": issue_context(self.foreign, self.other), "operationId": str(uuid4()),
                    "expectedRevision": 0, "payload": reference(creation)}
        response = self.client.post(f"/api/v1/workspaces/{self.foreign.pk}/commands/undo", envelope,
                                    content_type="application/json")
        self.assertEqual(response.status_code, 404)

    def test_move_tags_and_structural_deletion_restore_prior_edges(self):
        project, tag = str(uuid4()), str(uuid4())
        self.command("create-container", {"id": project, "title": "Office"})
        self.command("create-tag", {"id": tag, "title": "Phone"})
        first, second = self.capture(["One", "Two"])
        move = self.command("move", {"ids": [first, second], "parentId": project})
        set_tag = self.command("set-tags", {"ids": [second], "tagId": tag, "enabled": True})
        deleted = self.command("delete", {"ids": [project]})
        self.command("undo", reference(deleted))
        self.assertEqual(Item.objects.filter(workspace=self.space, shelf="active").count(), 3)
        inverse_tag = self.command("undo", reference(set_tag))
        self.assertFalse(ItemTag.objects.filter(item_id=second, tag_id=tag).exists())
        inverse_move = self.command("undo", reference(move))
        self.assertEqual(list(Item.objects.filter(kind="action", parent=None).order_by("position")
                              .values_list("title", flat=True)), ["One", "Two"])
        self.command("redo", reference(inverse_move))
        self.command("redo", reference(inverse_tag))
        self.assertTrue(ItemTag.objects.filter(item_id=second, tag_id=tag).exists())
        self.assertEqual(str(Item.objects.get(pk=first).parent_id), project)

    def test_intervening_write_fencing_and_preferences_are_protected(self):
        item, = self.capture(["Base"])
        edit = self.command("bulk-edit", {"ids": [item], "title": "Draft"})
        pref = self.command("set-filing-policy", {"policy": "both"})
        self.assertFalse(pref["undoable"])
        self.command("undo", reference(edit), 409)
        newer = self.command("bulk-edit", {"ids": [item], "title": "Newer"})
        Workspace.objects.filter(pk=self.space.pk).update(generation=uuid4())
        self.space.refresh_from_db()
        self.context = issue_context(self.space, self.owner)
        self.command("undo", reference(newer), 409)
        self.assertEqual(Item.objects.get(pk=item).title, "Newer")

    def test_redo_of_recurring_completion_restores_one_exact_successor(self):
        from core.models import Occurrence

        task, = self.capture(["Battery"])
        self.command("bulk-edit", {"ids": [task], "due": "2026-11-21"})
        self.command("set-repeat", {"id": task, "rule": {"schedule": "regular", "unit": "day", "count": 3}})
        completion = self.command("complete", {"ids": [task]})
        successor = Occurrence.objects.get(predecessor__item_id=task)
        first_ids = successor.pk, successor.item_id, successor.series_id
        inverse = self.command("undo", reference(completion))
        self.assertFalse(Occurrence.objects.filter(pk=first_ids[0]).exists())
        redo = self.command("redo", reference(inverse))
        repeated = Occurrence.objects.get(predecessor__item_id=task)
        self.assertEqual((repeated.pk, repeated.item_id, repeated.series_id), first_ids)
        self.assertEqual(repeated.item.schedule["due"]["value"], "2026-11-22")
        self.assertEqual((repeated.series.remaining, Occurrence.objects.count()), (2, 2))
        self.command("undo", reference(redo))
        self.assertEqual(Occurrence.objects.count(), 1)
