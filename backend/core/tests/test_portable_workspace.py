"""Use public command/read endpoints before and after transferring a workspace."""
import csv
import hashlib
import io
import json
from uuid import uuid4
from zipfile import ZipFile

from django.test import TestCase, override_settings
from core.commands.context import issue_context
from core.content.models import AttachmentBody
from core.models import Item, Job, Membership, Occurrence, ProjectReview, Receipt, Workspace
from core.perspectives.definition import DEFAULT
from core.perspectives.models import PerspectiveState, SavedPerspective
from core.preferences.models import AccountPreference, DevicePreference
from core.portability.models import RestoreReceipt

from .test_item_content import FileApiMixin, NOTE


class PortableWorkspaceTests(FileApiMixin, TestCase):
    def bundle(self, personal=False):
        response = self.client.get(self.base + "portability/bundle", {"personal": "1" if personal else "0"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        return b"".join(response.streaming_content)

    def restore(self, body, *, personal=False, account=False, operation=None):
        return self.client.post(self.base + f"portability/restore?personal={int(personal)}&accountSettings={int(account)}",
                                body, content_type="application/zip", headers={"X-Operation-Id": str(operation or uuid4())})

    @staticmethod
    def records(bundle):
        with ZipFile(io.BytesIO(bundle)) as archive:
            return json.loads(archive.read("records.json"))

    @staticmethod
    def replace_records(body, records):
        from core.portability.archive import counts, digest, encoded

        raw_records = encoded(records)
        output = io.BytesIO()
        with ZipFile(io.BytesIO(body)) as source, ZipFile(output, "w") as rewritten:
            manifest = json.loads(source.read("manifest.json"))
            manifest.update(counts=counts(records), recordBytes=len(raw_records), recordSha256=digest(raw_records))
            rewritten.writestr("manifest.json", encoded(manifest))
            rewritten.writestr("records.json", raw_records)
            for name in source.namelist():
                if name.startswith("files/"):
                    rewritten.writestr(name, source.read(name))
        return output.getvalue()

    def switch(self, workspace):
        self.space = workspace
        self.base = f"/api/v1/workspaces/{workspace.pk}/"
        self.context = issue_context(workspace, self.owner)

    def test_transfer_then_use_recurrence_review_shelf_restore_archive_and_file(self):
        project = str(uuid4())
        self.command("create-container", {"id": project, "title": "Field work"})
        task, trashed, following, archived = self.capture(["=Café, β", "Bring tripod", "Control point", "Archived drawing"], project)
        self.set_note(task, NOTE)
        raw = b"bench\n"
        self.assertEqual(self.upload(task, raw, self.upload_headers(task, raw)).status_code, 200)
        self.command("set-schedule", {"ids": [task], "schedule": {"due": {"kind": "date", "value": "2026-11-22"}}})
        self.command("set-repeat", {"id": task, "rule": {"schedule": "regular", "unit": "day", "count": 4}})
        self.command("mark-reviewed", {"projectId": project})
        self.command("delete", {"ids": [trashed]})
        self.command("complete", {"ids": [archived]})
        self.command("archive", {"ids": [archived], "before": "2090-11-22"})
        generation = self.space.generation
        body = self.bundle()
        operation = uuid4()
        result = self.restore(body, operation=operation)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(self.restore(body, operation=operation).json(), result.json())
        self.assertEqual(RestoreReceipt.objects.count(), 1)
        destination = Workspace.objects.get(pk=result.json()["workspaceId"])
        self.assertNotEqual(destination.generation, generation)
        self.assertIsNone(destination.private_owner_id)
        self.assertEqual(list(destination.membership_set.values_list("user_id", "role")), [(self.owner.pk, "owner")])
        self.assertFalse(Receipt.objects.filter(workspace=destination).exists())
        self.switch(destination)
        copies = {row.title: row for row in Item.objects.filter(workspace=destination)}
        project_copy = copies["Field work"]
        task_copy = copies["=Café, β"]
        trash_copy = copies["Bring tripod"]
        archive_copy = copies["Archived drawing"]
        self.assertNotEqual(str(task_copy.pk), task)
        self.assertEqual(trash_copy.shelf_before, copies["Control point"].pk)
        self.assertEqual(ProjectReview.objects.get(project=project_copy).last_reviewed_at,
                         ProjectReview.objects.get(project_id=project).last_reviewed_at)
        self.assertIsNone(ProjectReview.objects.get(project=project_copy).last_actor_id)
        history = self.client.get(self.base + "portability/history").json()
        self.assertTrue(any(str(task_copy.pk) in entry["items"] for entry in history["history"]))
        self.assertEqual(history["reviewSources"], [{"project": str(project_copy.pk), "reviewer": f"member:{self.owner.pk}"}])
        content = self.metadata(task_copy.pk).json()
        self.assertEqual(content["document"], NOTE)
        link = content["files"][0]
        self.assertEqual(link["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(self.download(task_copy.pk, link["id"]).content, raw)
        self.command("restore", {"ids": [str(trash_copy.pk)]})
        self.assertEqual(list(Item.objects.filter(parent=project_copy, shelf="active").order_by("position")
                              .values_list("title", flat=True)), ["=Café, β", "Bring tripod", "Control point"])
        self.command("retrieve", {"ids": [str(archive_copy.pk)]})
        self.assertTrue(Item.objects.filter(pk=archive_copy.pk, shelf="archive").exists())
        self.command("complete", {"ids": [str(task_copy.pk)]})
        original = Occurrence.objects.get(item=task_copy)
        self.assertEqual(Occurrence.objects.get(predecessor=original).item.schedule["due"]["value"], "2026-11-23")

    def test_private_views_account_settings_and_device_ownership(self):
        name = "Owner-only private filters"
        private = PerspectiveState.objects.create(workspace=self.space, user=self.owner)
        SavedPerspective.objects.create(state=private, view_id=uuid4(), name=name, definition=DEFAULT)
        other = PerspectiveState.objects.create(workspace=self.space, user=self.other)
        SavedPerspective.objects.create(state=other, view_id=uuid4(), name="Hidden other plan", definition=DEFAULT)
        membership = Membership.objects.create(workspace=self.space, user=self.other, role="viewer")
        DevicePreference.objects.create(workspace=self.space, user=self.owner, device=uuid4(), values={"sidebarSize": 199})
        prefs = AccountPreference.objects.create(user=self.owner, values={"density": "compact"})
        folder = str(uuid4())
        self.command("create-container", {"id": folder, "kind": "folder", "title": "Sites"})
        removed_focus = str(uuid4())
        private.focus_ids = [folder, removed_focus]
        private.save()
        view = private.perspectives.get()
        view.definition = {**DEFAULT, "scopeIds": [folder]}
        view.save()
        plain = self.bundle()
        body = self.bundle(True)
        self.assertIsNone(self.records(plain)["personal"])
        self.assertNotIn("Hidden other plan", json.dumps(self.records(body), ensure_ascii=False))
        prefs.values = {"theme": "dark"}
        prefs.save()
        result = self.restore(body, personal=True)
        self.assertEqual(result.status_code, 200, result.content)
        destination = Workspace.objects.get(pk=result.json()["workspaceId"])
        new_view = SavedPerspective.objects.get(state__workspace=destination)
        self.assertEqual(new_view.name, name)
        dest_folder = str(Item.objects.get(workspace=destination, title="Sites").pk)
        self.assertEqual(new_view.definition["scopeIds"], [dest_folder])
        self.assertEqual(new_view.state.focus_ids[0], dest_folder)
        self.assertEqual(len(new_view.state.focus_ids), 2)
        self.assertNotEqual(new_view.state.focus_ids[1], removed_focus)
        self.assertFalse(Item.objects.filter(pk=new_view.state.focus_ids[1]).exists())
        self.assertEqual(DevicePreference.objects.get(workspace=destination).values, {"sidebarSize": 199})
        prefs.refresh_from_db()
        self.assertEqual(prefs.values, {"theme": "dark"})
        self.assertEqual(self.restore(body, personal=True, account=True).status_code, 200)
        prefs.refresh_from_db()
        self.assertEqual(prefs.values, {"density": "compact"})
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.base + "portability/bundle").status_code, 403)
        self.assertEqual(self.client.get(self.base + "portability/outline.csv").status_code, 403)
        self.assertEqual(self.restore(body).status_code, 403)
        personal = self.client.get(self.base + "portability/personal").json()
        self.assertEqual([v["name"] for v in personal["views"]], ["Hidden other plan"])
        membership.delete()
        self.assertEqual(self.client.get(self.base + "portability/personal").status_code, 404)
        self.assertEqual(self.client.get(self.base + "portability/history").status_code, 404)

    def test_csv_uses_a_real_reader_manual_order_and_formula_neutralization(self):
        first, second, third = self.capture(["=SUM(1,2)", "Étage", "Other"])
        self.command("reorder", {"ids": [second], "parentId": "inbox", "beforeId": first})
        self.set_note(first, {"paragraphs": [[{"text": '+Field, "quoted"'}], [{"text": "β"}]]})
        out = self.client.get(self.base + "portability/outline.csv", {"id": [first, second]})
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out["X-Row-Count"], "2")
        rows = list(csv.DictReader(io.StringIO(out.content.decode(), newline="")))
        self.assertEqual([row["id"] for row in rows], [second, first])
        self.assertEqual(rows[0]["title"], "Étage")
        self.assertEqual(rows[1]["title"], "'=SUM(1,2)")
        self.assertEqual(rows[1]["note"], "'+Field, \"quoted\"\nβ")
        self.assertEqual(self.client.get(self.base + "portability/outline.csv", {"id": uuid4()}).status_code, 404)

    def test_tampering_different_payload_replay_or_cache_loss_never_changes_destination(self):
        task, = self.capture(["Tripod"])
        raw = b"readable"
        self.upload(task, raw, self.upload_headers(task, raw))
        body = self.bundle()
        output = io.BytesIO()
        with ZipFile(io.BytesIO(body)) as source, ZipFile(output, "w") as altered:
            for name in source.namelist():
                altered.writestr(name, b"changed!" if name.startswith("files/") else source.read(name))
        original_count = Workspace.objects.count()
        self.assertEqual(self.restore(output.getvalue()).status_code, 422)
        with override_settings(ATTACHMENT_MAX_BYTES=2):
            self.assertEqual(self.restore(body).status_code, 413)
        self.assertEqual(Workspace.objects.count(), original_count)
        self.assertEqual(AttachmentBody.objects.count(), 1)
        self.assertFalse(Job.objects.exists())
        op = uuid4()
        result = self.restore(body, operation=op)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(self.restore(self.bundle(True), operation=op).status_code, 409)
        Membership.objects.filter(workspace_id=result.json()["workspaceId"]).delete()
        self.assertEqual(self.restore(body, operation=op).status_code, 404)

    def test_restored_import_is_deduplicated_and_can_roll_back_without_touching_source(self):
        source = b"id,title\nstation,Survey station\n"
        route = "imports/?format=csv"

        def stage():
            return self.client.post(self.base + route, source, content_type="application/octet-stream").json()

        def transition(batch, kind):
            self.space.refresh_from_db()
            return self.client.post(self.base + f"imports/{batch}/{kind}", {
                "context": self.context, "operationId": str(uuid4()), "expectedRevision": self.space.revision,
            }, content_type="application/json")

        staged = stage()
        self.assertTrue(staged["canCommit"], staged.get("issues"))
        self.assertEqual(transition(staged["id"], "commit").status_code, 200)
        source_space = self.space
        result = self.restore(self.bundle())
        self.assertEqual(result.status_code, 200, result.content)
        self.switch(Workspace.objects.get(pk=result.json()["workspaceId"]))
        restored = stage()
        self.assertEqual(restored["status"], "committed")
        self.assertNotEqual(staged["id"], restored["id"])
        self.assertEqual(Item.objects.filter(workspace=self.space).count(), 1)
        response = transition(restored["id"], "rollback")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Item.objects.filter(workspace=self.space, shelf="active").exists())
        self.assertTrue(Item.objects.filter(workspace=source_space, title="Survey station").exists())

    def test_restored_reminders_and_connections_require_rebinding_and_place_keeps_new_tag(self):
        from django.utils import timezone
        from core.integrations.models import CalendarConnection, Reminder, TagPlace
        from core.models import Tag

        task, = self.capture(["Tripod"])
        tag = Tag.objects.create(workspace=self.space, title="Site")
        TagPlace.objects.create(tag=tag, latitude=28.1, longitude=-82.1, radius_meters=100)
        Reminder.objects.create(workspace=self.space, user=self.owner, item_id=task, at=timezone.now(), public_id=uuid4())
        CalendarConnection.objects.create(workspace=self.space, user=self.owner, source="fixture")
        CalendarConnection.objects.create(workspace=self.space, user=self.other, source="secret-neighbor")
        personal = self.bundle(True)
        self.assertNotIn(b"secret-neighbor", personal)
        for include in (False, True):
            response = self.restore(personal, personal=include)
            self.assertEqual(response.status_code, 200, response.content)
            destination = Workspace.objects.get(pk=response.json()["workspaceId"])
            copied_place = TagPlace.objects.get(tag__workspace=destination)
            self.assertNotEqual(copied_place.tag_id, tag.pk)
            self.assertEqual(copied_place.latitude, 28.1)
            personal_reminders = Reminder.objects.filter(workspace=destination)
            subscriptions = CalendarConnection.objects.filter(workspace=destination)
            if include:
                reminder = personal_reminders.get()
                self.assertEqual((reminder.status, reminder.item.title), ("paused", "Tripod"))
                self.assertEqual(list(subscriptions.values_list("source", "status")), [("fixture", "disconnected")])
            else:
                self.assertFalse(personal_reminders.exists())
                self.assertFalse(subscriptions.exists())
            self.assertFalse(Job.objects.filter(workspace=destination).exists())

    def test_inconsistent_graph_and_cross_workspace_parent_are_rejected_atomically(self):
        task, = self.capture(["Team project"])
        body = self.bundle()
        for target in (task, str(uuid4())):
            records = self.records(body)
            records["items"][0]["parent_id"] = target
            before = Workspace.objects.count()
            self.assertEqual(self.restore(self.replace_records(body, records)).status_code, 422)
            self.assertEqual(Workspace.objects.count(), before)
            self.assertFalse(RestoreReceipt.objects.exists())

    def test_invalid_active_repeat_anchor_time_or_origin_rejects_entire_restore(self):
        task, = self.capture(["Calibrate instrument"])
        due = {"kind": "floating", "value": "2026-11-22T08:30"}
        self.command("set-schedule", {"ids": [task], "schedule": {"due": due}})
        self.command("set-repeat", {"id": task, "rule": {"schedule": "regular", "unit": "hour"}})
        body = self.bundle()
        for schedule, origin in (
            ({}, {"due": due}),
            ({"due": {"kind": "date", "value": "2026-11-22"}}, {"due": due}),
            ({"due": due}, {}),
        ):
            with self.subTest(schedule=schedule, origin=origin):
                records = self.records(body)
                records["items"][0]["schedule"] = schedule
                records["series"][0]["origin"] = origin
                before = Workspace.objects.count()
                rejected = self.restore(self.replace_records(body, records))
                self.assertEqual(rejected.status_code, 422)
                self.assertEqual(Workspace.objects.count(), before)
                self.assertFalse(RestoreReceipt.objects.exists())

    def test_historical_and_stopped_repeats_can_retain_later_schedule_edits(self):
        task, stopped = self.capture(["Daily review", "Stopped timer"])
        timed = {"kind": "floating", "value": "2026-11-22T08:30"}
        for pk in (task, stopped):
            self.command("set-schedule", {"ids": [pk], "schedule": {"due": timed}})
            self.command("set-repeat", {"id": pk, "rule": {"schedule": "regular", "unit": "hour"}})
        self.command("complete", {"ids": [task]})
        self.command("stop-series", {"id": stopped, "seriesVersion": 1})
        self.command("set-schedule", {"ids": [task, stopped], "schedule": {"due": None}})
        result = self.restore(self.bundle())
        self.assertEqual(result.status_code, 200, result.content)
        rows = Occurrence.objects.filter(workspace_id=result.json()["workspaceId"]).select_related("series", "item")
        self.assertEqual(rows.get(outcome="completed").item.schedule, {})
        self.assertEqual(rows.get(series__active=False).item.schedule, {})
        self.assertIn("due", rows.get(series__active=True, outcome="open").item.schedule)
