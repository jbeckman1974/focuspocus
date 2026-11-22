from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase

from core.models import Change, Item
from core.repeats.models import Occurrence, RepeatSeries

from .outline_case import OutlineApiMixin


DAILY = {"schedule": "regular", "unit": "day", "count": 4}


class RepeatingCommandsTests(OutlineApiMixin, TestCase):
    def prepare(self, item, rule=DAILY, due="2026-11-18"):
        self.command("bulk-edit", {"ids": [item], "due": due})
        self.command("set-repeat", {"id": item, "rule": rule})
        return Occurrence.objects.select_related("series").get(item_id=item)

    def test_lost_ack_once_historical_time_stable_and_reopening_requires_compensation(self):
        item, = self.capture(["Repeating"])
        current = self.prepare(item)
        request = self.envelope({"ids": [item]})
        first = self.send("complete", request)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(self.send("complete", request).json(), first.json())
        successor = Occurrence.objects.get(predecessor=current)
        self.assertEqual(successor.item.schedule["due"]["value"], "2026-11-19")
        self.assertEqual(successor.series.remaining, 3)
        self.command("reopen", {"ids": [item]}, 409)
        self.command("set-completion-time", {
            "id": item, "seriesVersion": successor.series.version, "completedAt": "2026-11-17T20:00:00Z",
        })
        current.refresh_from_db()
        self.assertEqual(current.resolved_at.isoformat(), "2026-11-17T20:00:00+00:00")
        successor.item.refresh_from_db()
        self.assertEqual(successor.item.schedule["due"]["value"], "2026-11-19")

    def test_skip_stop_and_immediate_compensation(self):
        item, = self.capture(["Repeat class"])
        current = self.prepare(item)
        receipt = self.command("skip-occurrence", {"id": item, "seriesVersion": current.series.version})
        next_row = Occurrence.objects.get(predecessor=current)
        self.assertEqual(next_row.series.remaining, 4)
        current.refresh_from_db()
        self.assertEqual(current.outcome, "skipped")
        self.command("undo", {"operationId": receipt["operationId"], "contextId": receipt["contextId"]})
        current.refresh_from_db()
        self.assertEqual(current.outcome, "open")
        self.assertEqual(Occurrence.objects.filter(series=current.series).count(), 1)
        self.assertFalse(Item.objects.filter(pk=next_row.item_id).exists())
        self.command("stop-series", {"id": item, "seriesVersion": 1}, 409)
        self.command("stop-series", {"id": item, "seriesVersion": current.series.version})
        self.command("complete", {"ids": [item]})
        self.assertEqual(Occurrence.objects.count(), 1)

    def test_introducing_a_preferred_anchor_rebases_without_changing_past_or_remaining_count(self):
        item, = self.capture(["Plan first"])
        self.command("set-schedule", {"ids": [item], "schedule": {"planned": {"kind": "date", "value": "2026-11-18"}}})
        self.command("set-repeat", {"id": item, "rule": DAILY})
        self.command("set-schedule", {"ids": [item], "schedule": {"due": {"kind": "date", "value": "2026-11-23"}}})
        current = Occurrence.objects.get(item_id=item)
        self.assertEqual(current.series.remaining, 4)
        self.assertEqual(current.series.version, 2)
        self.command("complete", {"ids": [item]})
        successor = Occurrence.objects.get(predecessor=current)
        self.assertEqual(successor.item.schedule["due"]["value"], "2026-11-24")
        self.assertEqual(successor.item.schedule["planned"]["value"], "2026-11-19")

    def test_hourly_date_only_edit_fails_atomically(self):
        item, = self.capture(["Hourly"])
        timed = {"kind": "floating", "value": "2026-11-18T09:00"}
        self.command("set-schedule", {"ids": [item], "schedule": {"due": timed}})
        self.command("set-repeat", {"id": item, "rule": {"schedule": "regular", "unit": "hour"}})
        self.command("set-schedule", {"ids": [item], "schedule": {"due": {"kind": "date", "value": "2026-11-22"}}}, 422)
        self.assertEqual(Item.objects.get(pk=item).schedule["due"], timed)
        self.assertEqual(Occurrence.objects.get(item_id=item).series.version, 1)
        self.command("complete", {"ids": [item]})
        self.assertEqual(Occurrence.objects.get(predecessor__isnull=False).item.schedule["due"]["value"],
                         "2026-11-18T10:00")

    def test_nested_project_copies_reset_child_and_keep_independent_series(self):
        project = str(uuid4())
        self.command("create-container", {"id": project, "title": "Instrument checks"})
        group, child = self.capture(["Kit", "Batteries"], project)
        self.command("indent", {"ids": [child]})
        child_record = self.prepare(child, due="2026-11-21")
        self.command("complete", {"ids": [child]})
        prior_successor = Occurrence.objects.get(predecessor=child_record)
        self.prepare(project, {"schedule": "regular", "unit": "week"}, due="2026-11-21")
        receipt = self.command("complete", {"ids": [project]})
        project_record = Occurrence.objects.get(item_id=project)
        successor = Occurrence.objects.get(predecessor=project_record)
        new_group = Item.objects.get(parent=successor.item)
        children = list(Item.objects.filter(parent=new_group).order_by("position"))
        self.assertEqual(len(children), 2)
        self.assertTrue(all(not child.done and child.status == "active" for child in children))
        self.assertEqual({c.schedule["due"]["value"] for c in children}, {"2026-11-28", "2026-11-29"})
        self.assertEqual(len({c.occurrence.series_id for c in children} | {prior_successor.series_id}), 3)
        self.command("bulk-edit", {"ids": [str(children[0].pk)], "title": "Adjusted child"})
        self.command("undo", {"operationId": receipt["operationId"], "contextId": receipt["contextId"]}, 409)

    def test_repeat_successor_keeps_auto_completing_group_open(self):
        group, child = self.capture(["Kit", "Replace batteries"])
        self.command("indent", {"ids": [child]})
        self.command("set-properties", {"ids": [group], "autoComplete": True})
        self.prepare(child)
        self.command("complete", {"ids": [child]})
        self.assertFalse(Item.objects.get(pk=group).done)
        self.assertEqual(Item.objects.filter(parent_id=group, done=False).count(), 1)

    def test_private_preview_and_fault_rollback(self):
        item, = self.capture(["Repeat"])
        self.prepare(item)
        preview = {"id": item, "rule": DAILY}
        before = Change.objects.count()
        response = self.client.post(self.base + "repeat-preview", preview, content_type="application/json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["next"]["due"]["value"], "2026-11-19")
        self.assertEqual(Change.objects.count(), before)
        with patch("core.repeats.resolution.generate", side_effect=RuntimeError("test rollback")):
            with self.assertRaises(RuntimeError):
                self.send("complete", self.envelope({"ids": [item]}))
        self.assertFalse(Item.objects.get(pk=item).done)
        self.assertEqual(Occurrence.objects.get(item_id=item).outcome, "open")
        self.assertEqual(RepeatSeries.objects.get().remaining, 4)
        self.assertEqual(Change.objects.count(), before)
        self.client.force_login(self.other)
        response = self.client.post(self.base + "repeat-preview", preview, content_type="application/json")
        self.assertEqual(response.status_code, 404)
