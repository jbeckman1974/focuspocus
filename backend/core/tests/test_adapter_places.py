from uuid import uuid4

from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from core.commands.context import issue_context
from core.commands.validation import CommandError
from core.integrations import portable
from core.integrations.models import CalendarConnection, Reminder, TagPlace
from core.models import Change, Item, Job, Membership, Receipt, Tag
from core.perspectives.models import PerspectiveState
from core.tests.outline_case import OutlineApiMixin


class PlacesAndPortabilityTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.tag = Tag.objects.create(workspace=self.space, title="Survey site")
        self.task = self.capture(["Check monuments"])[0]
        self.place = {"tagId": str(self.tag.pk), "latitude": 27.9, "longitude": -82.4, "radiusMeters": 150}

    def write(self, body):
        self.tag.refresh_from_db()
        body = {"context": self.context, "operationId": str(uuid4()), "expectedVersion": self.tag.version, **body}
        return self.client.post(self.base + "integrations/places", body, content_type="application/json")

    def test_two_editors_retry_after_change_and_stale_removal(self):
        Membership.objects.create(user=self.other, workspace=self.space, role="editor")
        editor_context = issue_context(self.space, self.other)
        self.space.refresh_from_db()
        base = self.space.revision
        original = {**self.place, "expectedVersion": self.tag.version, "operationId": str(uuid4())}
        first = self.write(original)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["revision"], base + 1)
        saved = first.json()["places"][0]
        self.assertEqual(saved["version"], original["expectedVersion"] + 1)

        self.client.force_login(self.other)
        remove = {"context": editor_context, "operationId": str(uuid4()), "tagId": str(self.tag.pk),
                  "expectedVersion": original["expectedVersion"], "remove": True}
        self.assertEqual(self.write(remove).status_code, 409)
        second = self.write({**self.place, "context": editor_context, "expectedVersion": saved["version"],
                             "radiusMeters": 300})
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()["revision"], base + 2)

        # The owner never received the first response. Retrying the identical operation
        # must acknowledge it while returning the other editor's current coordinates.
        self.client.force_login(self.owner)
        retried = self.write(original)
        self.assertEqual(retried.json(), second.json())
        self.assertEqual(retried.json()["places"][0]["radiusMeters"], 300)
        self.assertEqual(self.write({**original, "latitude": 39.0}).status_code, 409)
        self.assertEqual(Receipt.objects.filter(workspace=self.space, operation_id=original["operationId"]).count(), 1)
        self.assertEqual(list(Change.objects.filter(workspace=self.space, revision__gt=base).order_by("revision")
                              .values_list("affected", flat=True)), [[str(self.tag.pk)], [str(self.tag.pk)]])

        latest = self.write({**self.place, "radiusMeters": 300})
        self.assertEqual(latest.json()["revision"], base + 2)
        deleted = self.write({"tagId": str(self.tag.pk), "remove": True})
        self.assertEqual(deleted.json(), {"revision": base + 3, "places": []})
        self.assertEqual(self.write({"tagId": str(self.tag.pk), "remove": True}).json(), deleted.json())
        Membership.objects.filter(user=self.owner, workspace=self.space).update(role="viewer")
        self.assertEqual(self.write(original).status_code, 403)

    def test_current_focus_and_availability_apply_to_tagged_rows(self):
        project = Item.objects.create(workspace=self.space, kind="project", title="Other project", position=100)
        self.command("set-tags", {"ids": [self.task], "tagId": str(self.tag.pk), "enabled": True})
        self.assertEqual(self.write(self.place).json()["places"][0]["itemIds"], [self.task])
        state = PerspectiveState.objects.create(workspace=self.space, user=self.owner, focus_ids=[str(project.pk)])
        path = self.base + "integrations/places"
        self.assertEqual(self.client.get(path).json()["places"][0]["itemIds"], [])
        state.delete()
        self.tag.status = "held"
        self.tag.save(update_fields=["status"])
        self.assertEqual(self.client.get(path).json()["places"][0]["itemIds"], [])
        self.assertEqual(self.client.post(path, self.place, content_type="application/json").status_code, 428)

    def test_only_authorized_editors_can_change_shared_tag_location(self):
        self.command("set-tags", {"ids": [self.task], "tagId": str(self.tag.pk), "enabled": True})
        response = self.write(self.place)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["places"][0]["itemIds"], [self.task])
        self.assertEqual(self.write({**self.place, "latitude": 100}).status_code, 422)
        self.assertEqual(self.write({**self.place, "tagId": str(uuid4())}).status_code, 404)
        self.command("complete", {"ids": [self.task]})
        self.assertEqual(self.client.get(self.base + "integrations/places").json()["places"][0]["itemIds"], [])
        Membership.objects.create(user=self.other, workspace=self.space, role="viewer")
        self.client.force_login(self.other)
        self.assertEqual(self.write({**self.place, "radiusMeters": 200}).status_code, 403)
        self.assertEqual(self.client.get(self.base + "integrations/places").status_code, 200)

    def test_restore_requires_rebinding_preserves_private_boundaries_and_rejects_foreign_ids(self):
        original = Item.objects.get(pk=self.task)
        TagPlace.objects.create(tag=self.tag, latitude=28, longitude=-82, radius_meters=10)
        Reminder.objects.create(workspace=self.space, user=self.owner, item=original, public_id=uuid4(), at=timezone.now())
        CalendarConnection.objects.create(workspace=self.space, user=self.owner, source="crew")
        shared = portable.export_settings(self.space, None)
        self.assertEqual(shared["reminders"], [])
        data = portable.export_settings(self.space, self.owner)
        destination_tag = Tag.objects.create(workspace=self.foreign, title="Restored site")
        destination_item = Item.objects.create(workspace=self.foreign, kind="action", title="Restored task", position=100)
        item_ids, tag_ids = {self.task: destination_item.pk}, {str(self.tag.pk): destination_tag.pk}
        with self.assertRaises(CommandError), transaction.atomic():
            portable.restore_settings(self.foreign, self.other, data, item_ids, {str(self.tag.pk):self.tag.pk})
        portable.restore_settings(self.foreign, self.other, data, item_ids, tag_ids)
        restored = Reminder.objects.get(workspace=self.foreign)
        self.assertEqual((restored.item_id, restored.status, restored.user_id),
                         (destination_item.pk, "paused", self.other.pk))
        self.assertEqual(CalendarConnection.objects.get(workspace=self.foreign).status, "disconnected")
        self.assertFalse(Job.objects.filter(workspace=self.foreign).exists())
