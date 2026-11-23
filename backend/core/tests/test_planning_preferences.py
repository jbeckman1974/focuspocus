from uuid import uuid4

from django.test import TestCase

from core.commands.context import issue_context
from core.models import Item, Membership
from .outline_case import OutlineApiMixin


class PreferenceTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.account = self.base + "preferences/account"
        self.device = self.base + "preferences/device/" + str(uuid4())

    def change(self, url, version, changes, status=200, headers=None):
        result = self.client.patch(
            url, {"expectedVersion": version, "changes": changes},
            content_type="application/json", headers=headers or {},
        )
        self.assertEqual(result.status_code, status, result.content)
        return result.json()

    def test_device_layout_and_account_choices_have_distinct_keys(self):
        self.assertEqual(self.client.get(self.account).json()["version"], 0)
        account = self.change(self.account, 0, {"density": "compact", "shortcut": "k"})
        self.change(self.device, 0, {"inspectorSize": 355, "inspectorOpen": False})
        another_device = self.base + "preferences/device/" + str(uuid4())
        self.assertIsNone(self.client.get(another_device).json()["values"]["inspectorOpen"])
        Membership.objects.create(workspace=self.foreign, user=self.owner, role="viewer")
        foreign = f"/api/v1/workspaces/{self.foreign.pk}/"
        self.assertEqual(self.client.get(self.account.replace(self.base, foreign)).json(), account)
        self.assertIsNone(self.client.get(self.device.replace(self.base, foreign)).json()["values"]["inspectorOpen"])
        self.change(self.account, 0, {"theme": "dark"}, 409)
        self.assertEqual(self.client.get(self.account).json(), account)
        self.assertEqual(self.client.get(self.device).json()["values"]["inspectorSize"], 355)
        self.space.refresh_from_db()
        self.assertEqual(self.space.revision, 0)

    def test_viewer_can_change_only_own_preferences_in_visible_workspaces(self):
        task, = self.capture(["Lantern"])
        self.change(self.account, 0, {"density": "compact"})
        self.change(self.device, 0, {"sidebarSize": 280})
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.account).status_code, 404)
        self.change(self.device, 0, {"inspectorOpen": False}, 404)
        membership = Membership.objects.create(workspace=self.space, user=self.other, role="viewer")
        self.assertEqual(self.client.get(self.account).json()["values"]["density"], "comfortable")
        self.assertEqual(self.client.get(self.device).json()["values"]["sidebarSize"], 212)
        self.change(self.account, 0, {"theme": "dark"})
        self.change(self.device, 0, {"inspectorOpen": True})
        self.context = issue_context(self.space, self.other)
        self.command("bulk-inspect", {"ids": [task], "changes": {"flagged": True}}, 403)
        stale_tab = {"X-FocusPocus-Actor": str(self.owner.pk)}
        self.assertEqual(self.client.get(self.account, headers=stale_tab).status_code, 403)
        self.change(self.account, 1, {"theme": "light"}, 403, headers=stale_tab)
        membership.delete()
        self.assertEqual(self.client.get(self.device).status_code, 404)
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(self.account).json()["values"]["theme"], "system")
        self.assertIsNone(self.client.get(self.device).json()["values"]["inspectorOpen"])

    def test_invalid_choices_and_cross_scope_fields_do_not_create_a_preference(self):
        for key, value in [("shortcut", "Meta+W"), ("density", ["compact"]), ("inspectorSize", 201),
                           ("dateDefaults", {"due": "26:10"}), ("dateDefaults", False)]:
            with self.subTest(key=key, value=value):
                self.change(self.account, 0, {key: value}, 422)
        for key, value in [("inspectorSize", True), ("sidebarSize", 800), ("inspectorOpen", 0), ("motion", "reduced")]:
            self.change(self.device, 0, {key: value}, 422)
        self.assertEqual(self.client.get(self.account).json()["version"], 0)
        self.assertEqual(self.client.get(self.device).json()["version"], 0)

    def test_actor_clock_is_captured_for_new_dates_and_never_retimes_existing_dates(self):
        old, new, third = self.capture(["Old due", "New due", "Other writer"])
        self.command("set-date-settings", {"dateDefaults": {"due": "18:00"}})
        date = {"kind": "date", "value": "2026-12-31"}
        self.command("set-schedule", {"ids": [old], "schedule": {"due": date}})
        self.change(self.account, 0, {"dateDefaults": {"due": "08:30"}})
        snapshot = self.client.get(self.base + "snapshot").json()
        self.assertEqual((snapshot["dateDefaults"]["due"], snapshot["assignmentDueTime"]), ("18:00", "08:30"))
        preview = self.client.get(self.base + "date-preview", {"field": "due", "text": date["value"]})
        self.assertEqual(preview.json()["value"], {**date, "defaultTime": "08:30"})
        self.command("bulk-inspect", {"ids": [new], "changes": {"schedule": {"due": date}}})
        self.change(self.account, 1, {"dateDefaults": {"due": None}})
        Membership.objects.create(workspace=self.space, user=self.other, role="editor")
        self.client.force_login(self.other)
        self.context = issue_context(self.space, self.other)
        self.change(self.account, 0, {"dateDefaults": {"due": "11:45"}})
        endpoint = self.base + "items/" + third
        etag = self.client.get(endpoint)["ETag"]
        result = self.client.patch(endpoint, self.envelope({"due": date["value"]}),
                                   content_type="application/json", headers={"If-Match": etag})
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual([Item.objects.get(pk=pk).schedule["due"]["defaultTime"] for pk in (old, new, third)],
                         ["18:00", "08:30", "11:45"])
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(self.account).json()["values"]["dateDefaults"]["due"], "18:00")
