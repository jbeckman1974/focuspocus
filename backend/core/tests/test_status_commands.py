from uuid import uuid4

from django.db import IntegrityError, transaction
from django.db.models.signals import post_init
from django.test import TestCase

from core.models import Item, Receipt
from core.rules.properties import status_updates

from .outline_case import OutlineApiMixin


class StatusCommandTests(OutlineApiMixin, TestCase):
    def test_last_action_auto_completes_two_ancestors_and_undo_restores_all(self):
        project = Item.objects.create(workspace=self.space, kind="project", title="Project", position=1, auto_complete=True)
        group = Item.objects.create(workspace=self.space, parent=project, kind="group", title="Group", position=1, auto_complete=True)
        first, last = self.capture(["A", "B"])
        self.command("move", {"ids": [first, last], "parentId": str(group.pk)})
        self.command("complete", {"ids": [first]})
        group.refresh_from_db()
        self.assertEqual(group.status, "active")
        result = self.command("complete", {"ids": [last]})
        for item in (group, project):
            item.refresh_from_db()
            self.assertEqual(item.status, "completed")
            self.assertIsNotNone(item.completed_at)
        self.command("undo", {"contextId": result["contextId"], "operationId": result["operationId"]})
        for item in Item.objects.filter(pk__in=[group.pk, project.pk, last]):
            self.assertEqual(item.status, "active")
            self.assertIsNone(item.completed_at)
        self.assertTrue(Item.objects.get(pk=first).done)

    def test_status_command_reads_only_selected_ancestry_and_undo_keeps_unrelated_tasks(self):
        unrelated = Item.objects.bulk_create([
            Item(workspace=self.space, kind="action", title=f"Inbox {position}", position=position)
            for position in range(300)
        ])
        project = Item.objects.create(workspace=self.space, kind="project", title="Survey", position=1,
                                      auto_complete=True)
        group = Item.objects.create(workspace=self.space, parent=project, kind="group", title="Group",
                                    position=1, auto_complete=True)
        action = self.capture(["Measure"], parent=str(group.pk))[0]
        loaded = set()

        def record_loaded(sender, instance, **kwargs):
            loaded.add(instance.pk)

        post_init.connect(record_loaded, sender=Item)
        try:
            receipt = self.command("complete", {"ids": [action]})
        finally:
            post_init.disconnect(record_loaded, sender=Item)
        self.assertFalse(loaded.intersection(item.pk for item in unrelated))
        self.assertEqual(set(receipt["versions"]), {str(project.pk), str(group.pk), action})
        self.command("undo", {"contextId": receipt["contextId"], "operationId": receipt["operationId"]})
        self.assertFalse(Item.objects.filter(workspace=self.space, done=True).exists())

    def test_legacy_m2_inverse_remains_usable(self):
        item = self.capture(["A"])[0]
        result = self.command("complete", {"ids": [item]})
        Receipt.objects.filter(operation_id=result["operationId"]).update(inverse={"done": {item: False}})
        self.command("undo", {"contextId": result["contextId"], "operationId": result["operationId"]})
        self.assertFalse(Item.objects.get(pk=item).done)

    def test_database_prevents_invalid_container_policy_and_direct_state(self):
        for fields in [dict(kind="action", mode="parallel"), dict(kind="group", mode="single-action"),
                       dict(kind="project", mode="single-action", auto_complete=True),
                       dict(kind="action", **status_updates("held")), dict(kind="folder", done=True)]:
            with self.subTest(fields=fields), self.assertRaises(IntegrityError), transaction.atomic():
                Item.objects.create(pk=uuid4(), workspace=self.space, title="Invalid", position=1, **fields)
