from uuid import uuid4

from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from core.commands.validation import CommandError
from core.integrations import portable
from core.integrations.models import CalendarConnection, Reminder, TagPlace
from core.models import Item, Job, Membership, Tag
from core.tests.outline_case import OutlineApiMixin


class PlacesAndPortabilityTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.tag = Tag.objects.create(workspace=self.space, title="Survey site")
        self.task = self.capture(["Check monuments"])[0]
        self.place = {"tagId":str(self.tag.pk),"latitude":27.9,"longitude":-82.4,"radiusMeters":150}

    def write(self, body):
        return self.client.post(self.base + "integrations/places", body, content_type="application/json")

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
