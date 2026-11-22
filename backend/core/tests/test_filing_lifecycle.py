from datetime import datetime, timezone
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase

from core.models import Item

from .outline_case import OutlineApiMixin


class LifecycleTests(OutlineApiMixin, TestCase):
    def create(self, kind, title, **properties):
        pk = str(uuid4())
        if kind == "tag":
            self.command("create-tag", {"id": pk, "title": title, **properties})
        elif kind == "action":
            self.command("capture", {"parentId": properties.pop("parentId", "inbox"),
                                     "items": [{"id": pk, "title": title, **properties}]})
        else:
            self.command("create-container", {"kind": kind, "id": pk, "title": title, **properties})
        return pk

    def item(self, pk):
        return self.client.get(self.base + "items/" + pk).json()

    def test_folder_destinations_cycles_mixed_invalid_and_sibling_order(self):
        folder = self.create("folder", "Office")
        nested = self.create("folder", "Surveys", parentId=folder)
        project = self.create("project", "Traverse", parentId=folder)
        task = self.create("action", "Station", parentId=project)
        self.command("move", {"ids": [folder], "parentId": nested}, 422)
        self.command("move", {"ids": [nested, task], "parentId": "root"}, 422)
        self.command("move", {"ids": [project], "parentId": "inbox"}, 422)
        self.command("reorder", {"ids": [project], "parentId": folder, "beforeId": nested})
        self.assertEqual(list(Item.objects.filter(parent_id=folder).order_by("position").values_list("title", flat=True)),
                         ["Traverse", "Surveys"])
        self.command("move", {"ids": [project], "parentId": nested})
        self.assertEqual(self.item(project)["parentId"], nested)
        self.assertEqual(self.item(task)["parentId"], project)
        self.command("outdent", {"ids": [project]})
        self.assertEqual(self.item(project)["parentId"], folder)

    def test_deleted_child_requires_live_destination_and_stays_private(self):
        project = self.create("project", "Field")
        child = self.create("action", "Bench", parentId=project)
        self.command("delete", {"ids": [child]})
        self.command("delete", {"ids": [project]})
        self.assertEqual(self.client.get(self.base + "items/" + child).status_code, 404)
        self.command("bulk-edit", {"ids": [child], "title": "Changed"}, 404)
        self.command("restore", {"ids": [child]}, 409)
        self.command("restore", {"ids": [child], "parentId": "inbox"})
        self.assertEqual(self.item(child)["parentId"], "inbox")
        shelf = self.client.get(self.base + "shelf?state=trash")
        self.assertEqual([item["id"] for item in shelf.json()["items"]], [project])
        self.assertIn("no-store", shelf.headers["Cache-Control"])
        outsider = get_user_model().objects.create_user(username="other-filing-account")
        self.client.force_login(outsider)
        self.assertEqual(self.client.get(self.base + "shelf?state=trash").status_code, 404)
        self.assertEqual(self.client.get(self.base + "archive-preview?before=2026-01-01").status_code, 404)

    def test_dropped_archive_cutoff_keeps_prior_changed_time_and_rejects_ineligible_mix(self):
        old = self.create("action", "Archived candidate")
        current = self.create("action", "Current")
        timestamp = datetime(2026, 11, 19, tzinfo=timezone.utc)
        Item.objects.filter(pk=old).update(disposition="dropped", dropped_at=timestamp, changed_at=timestamp)
        self.assertEqual(self.client.get(self.base + "archive-preview?before=2026-11-19").json()["items"], [])
        preview = self.client.get(self.base + "archive-preview?before=2026-11-20")
        self.assertEqual([item["id"] for item in preview.json()["items"]], [old])
        self.command("archive", {"ids": [old, current], "before": "2026-11-20"}, 409)
        self.assertEqual(self.item(old)["id"], old)
        self.command("archive", {"ids": [old], "before": "2026-11-20"})
        self.assertEqual(Item.objects.get(pk=old).changed_at, timestamp)
        for _ in range(2):
            fresh, = self.command("retrieve", {"ids": [old]})["selection"]
            self.assertNotEqual(fresh, old)
        self.assertEqual([item["id"] for item in self.client.get(self.base + "shelf?state=archive").json()["items"]], [old])

    def test_nested_exclusive_choices_and_insertion_copy(self):
        project = self.create("project", "Survey")
        where = self.create("tag", "Venue", exclusive=True)
        field = self.create("tag", "Field", parentId=where)
        east = self.create("tag", "East", parentId=field)
        desk = self.create("tag", "Desk", parentId=where)
        independent = self.create("tag", "Reference")
        self.command("set-tags", {"ids": [project], "tagId": independent, "enabled": True})
        blank = self.create("action", "Blank", parentId=project)
        explicitly_tagged = self.create("action", "Tagged", parentId=project, tagIds=[east])
        self.command("set-tags", {"ids": [project], "tagId": independent, "enabled": False})
        self.assertEqual(self.item(blank)["tags"], [independent])
        self.assertEqual(self.item(explicitly_tagged)["tags"], [east])
        self.command("set-tags", {"ids": [blank], "tagId": east, "enabled": True})
        self.command("set-tags", {"ids": [blank], "tagId": desk, "enabled": True})
        self.assertEqual(set(self.item(blank)["tags"]), {independent, desk})
        self.command("set-tags", {"ids": [blank], "tagId": where, "enabled": True})
        self.assertEqual(set(self.item(blank)["tags"]), {independent, where})
        self.command("edit-tag", {"id": where, "parentId": east}, 422)
        self.command("edit-tag", {"id": where, "status": "dropped"})
        self.command("set-tags", {"ids": [blank], "tagId": east, "enabled": True}, 422)

    def test_filing_policy_separates_inbox_classification_from_placement(self):
        project = self.create("project", "Work")
        tag = self.create("tag", "Desk")
        designated = self.create("action", "Assigned", filingProjectId=project)
        tagged = self.create("action", "Tagged", tagIds=[tag])
        both = self.create("action", "Both", filingProjectId=project, tagIds=[tag])
        self.assertEqual(self.item(designated)["parentId"], "inbox")
        self.command("set-filing-policy", {"policy": "both"})
        self.assertEqual(self.command("file-inbox", {})["selection"], [both])
        self.command("set-filing-policy", {"policy": "project"})
        self.assertEqual(self.command("file-inbox", {})["selection"], [designated])
        self.command("set-filing-policy", {"policy": "tag"})
        self.assertEqual(self.command("file-inbox", {})["selection"], [tagged])
        misc = Item.objects.get(workspace=self.space, is_miscellaneous=True)
        self.assertEqual(self.item(tagged)["parentId"], str(misc.pk))
        self.assertEqual(misc.mode, "single-action")
        later = self.create("action", "Tagged later", tagIds=[tag])
        self.command("set-filing-policy", {"policy": "either"})
        self.assertEqual(self.command("file-inbox", {})["selection"], [later])
        self.assertEqual(self.item(later)["parentId"], str(misc.pk))
        self.assertEqual(self.command("file-inbox", {})["selection"], [])
