from uuid import uuid4

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase

from core.models import Item, Membership, Receipt

from .outline_case import OutlineApiMixin


class BoardProgressTests(OutlineApiMixin, TestCase):
    def test_progress_is_shared_versioned_and_reversible_independently_of_completion(self):
        first, second = self.capture(["Notebook", "Tripod"])
        original = self.envelope({"ids": [first, second], "inProgress": True})
        saved = self.send("set-properties", original)
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(self.send("set-properties", original).json(), saved.json())
        self.assertEqual(Receipt.objects.filter(operation_id=original["operationId"]).count(), 1)
        rows = self.client.get(self.base + "snapshot").json()["tasks"]
        self.assertTrue(all(row["inProgress"] and not row["done"] and not row["flagged"] for row in rows))
        stale = self.envelope({"ids": [first], "inProgress": False}, expectedRevision=original["expectedRevision"])
        self.assertEqual(self.send("set-properties", stale).status_code, 409)
        receipt = saved.json()
        undo = self.command("undo", {"operationId": receipt["operationId"], "contextId": receipt["contextId"]})
        self.assertFalse(Item.objects.filter(workspace=self.space, in_progress=True).exists())
        self.command("redo", {"operationId": undo["operationId"], "contextId": undo["contextId"]})
        self.command("complete", {"ids": [first]})
        self.assertTrue(Item.objects.get(pk=first).in_progress)
        self.command("reopen", {"ids": [first]})
        self.assertTrue(self.client.get(self.base + "items/" + first).json()["inProgress"])
        self.command("set-properties", {"ids": [first], "inProgress": False})
        self.assertTrue(Item.objects.get(pk=second).in_progress)

    def test_invalid_and_unauthorized_board_updates_change_no_tasks(self):
        task, = self.capture(["Private"])
        project = str(uuid4())
        self.command("create-container", {"id": project, "title": "Project"})
        self.command("set-properties", {"ids": [task, project], "inProgress": True}, status=422)
        self.command("set-properties", {"ids": [task], "inProgress": "true"}, status=422)
        self.client.force_login(self.other)
        self.command("set-properties", {"ids": [task], "inProgress": True}, status=404)
        Membership.objects.create(workspace=self.space, user=self.other, role="viewer")
        self.command("set-properties", {"ids": [task], "inProgress": True}, status=403)
        self.assertFalse(Item.objects.get(pk=task).in_progress)

    def test_undo_redo_accept_item_journals_saved_before_the_progress_field(self):
        task, = self.capture(["Original"])
        renamed = self.command("bulk-edit", {"ids": [task], "title": "Edited"})
        receipt = Receipt.objects.get(operation_id=renamed["operationId"])
        for row in receipt.inverse["journal"]["rows"]:
            if row["model"] == "item":
                for side in ("before", "after"):
                    row[side].pop("in_progress")
        receipt.save(update_fields=["inverse"])
        undo = self.command("undo", {"operationId": renamed["operationId"], "contextId": renamed["contextId"]})
        self.assertEqual(Item.objects.get(pk=task).title, "Original")
        self.command("redo", {"operationId": undo["operationId"], "contextId": undo["contextId"]})
        item = Item.objects.get(pk=task)
        self.assertEqual(item.title, "Edited")
        self.assertFalse(item.in_progress)


class BoardProgressMigrationTests(TransactionTestCase):
    def test_populated_outline_defaults_to_unstarted_without_changing_existing_state(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(latest))
        before = [("core", "0021_membership_incarnations")]
        executor.migrate(before)
        old = executor.loader.project_state(before).apps
        workspace = old.get_model("core", "Workspace").objects.create()
        original = old.get_model("core", "Item").objects.create(
            workspace=workspace, kind="action", title="Existing item", position=1, flagged=True, version=4,
        )
        MigrationExecutor(connection).migrate(latest)
        item = Item.objects.get(pk=original.pk)
        self.assertEqual((item.in_progress, item.flagged, item.version, item.title), (False, True, 4, "Existing item"))
