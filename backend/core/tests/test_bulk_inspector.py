from uuid import uuid4

from django.test import TestCase

from core.models import Item, ItemTag, Tag
from .outline_case import OutlineApiMixin
from .test_command_history import reference


class BulkInspectorTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.first, self.second = self.capture(["Lantern", "Batteries"])
        self.ids = [self.first, self.second]
        self.tag = str(uuid4())
        self.command("create-tag", {"id": self.tag, "title": "Field"})
        self.command("set-tags", {"ids": [self.first], "tagId": self.tag, "enabled": True})
        self.command("set-schedule", {"ids": [self.second], "durationMinutes": 11})
        self.command("set-properties", {"ids": [self.first], "flagged": True})

    def items(self):
        return [Item.objects.get(pk=pk) for pk in self.ids]

    def test_mixed_values_keep_unsubmitted_properties_one_receipt_and_undo(self):
        later = {"kind": "date", "value": "2026-11-30"}
        patch = {"schedule": {"planned": later}, "flagged": True}
        body = self.envelope({"ids": self.ids, "changes": patch})
        response = self.send("bulk-inspect", body)
        self.assertEqual(response.status_code, 200, response.content)
        receipt = response.json()
        self.assertEqual(receipt["revision"], body["expectedRevision"] + 1)
        self.assertTrue(receipt["undoable"])
        self.assertEqual(receipt["selection"], self.ids)
        self.assertEqual(self.send("bulk-inspect", body).json(), receipt)
        first, second = self.items()
        self.assertTrue(first.flagged and second.flagged)
        self.assertEqual([row.schedule["planned"]["value"] for row in (first, second)], [later["value"]] * 2)
        self.assertEqual((first.title, second.title), ("Lantern", "Batteries"))
        self.assertEqual((first.duration_minutes, second.duration_minutes), (None, 11))
        self.assertEqual(list(ItemTag.objects.values_list("item_id", flat=True)), [first.pk])
        self.command("undo", reference(receipt))
        first, second = self.items()
        self.assertTrue(first.flagged)
        self.assertFalse(second.flagged)
        self.assertEqual((first.schedule, second.schedule), ({}, {}))

    def test_stale_draft_and_foreign_tag_roll_back_every_field(self):
        foreign = Tag.objects.create(workspace=self.foreign, title="Private classification")
        stale = self.envelope({"ids": self.ids, "changes": {"flagged": True}})
        self.command("bulk-edit", {"ids": [self.second], "title": "Charged batteries"})
        self.assertEqual(self.send("bulk-inspect", stale).status_code, 409)
        self.space.refresh_from_db()
        revision = self.space.revision
        self.command("bulk-inspect", {"ids": self.ids, "changes": {
            "title": "Overwritten", "durationMinutes": 1,
            "tags": [{"tagId": str(foreign.pk), "enabled": True}],
        }}, 404)
        first, second = self.items()
        self.assertEqual((first.title, second.title), ("Lantern", "Charged batteries"))
        self.assertEqual((first.duration_minutes, second.duration_minutes), (None, 11))
        self.space.refresh_from_db()
        self.assertEqual(self.space.revision, revision)

    def test_repeat_validation_rolls_back_and_completion_creates_one_undoable_successor(self):
        due = {"kind": "date", "value": "2026-11-28"}
        self.command("set-schedule", {"ids": self.ids, "schedule": {"due": due}})
        self.command("set-repeat", {"id": self.second, "rule": {"schedule": "regular", "unit": "day", "count": 3}})
        self.command("bulk-inspect", {"ids": self.ids, "changes": {"title": "Rejected", "schedule": {"due": None}}}, 422)
        self.assertEqual([row.title for row in self.items()], ["Lantern", "Batteries"])
        self.assertTrue(all(row.schedule["due"]["value"] == due["value"] for row in self.items()))
        receipt = self.command("bulk-inspect", {"ids": self.ids, "changes": {
            "title": "Daily check", "status": "completed", "flagged": True,
            "tags": [{"tagId": self.tag, "enabled": True}],
        }})
        successor = Item.objects.filter(workspace=self.space).exclude(pk__in=self.ids).get()
        self.assertEqual((successor.title, successor.flagged, successor.status), ("Daily check", True, "active"))
        self.assertTrue(successor.tags.filter(pk=self.tag).exists())
        self.command("undo", reference(receipt))
        self.assertFalse(Item.objects.filter(pk=successor.pk).exists())
        self.assertEqual([row.title for row in self.items()], ["Lantern", "Batteries"])
        self.assertFalse(ItemTag.objects.filter(item_id=self.second).exists())
