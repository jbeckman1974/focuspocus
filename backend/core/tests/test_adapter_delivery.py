from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import jwt
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.test import TestCase
from django.utils import timezone

from core.integrations import delivery, push
from core.integrations.membership import hold_after_restore, revoke_personal
from core.integrations.models import PushDevice, Reminder, ReminderDelivery
from core.models import Job, Membership
from core.sync import jobs
from core.tests.outline_case import OutlineApiMixin


class ReminderTests(OutlineApiMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.task = self.capture(["Synthetic visit"])[0]
        self.device = str(uuid4())
        self.endpoint = f"https://web.push.apple.com/{uuid4()}"
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        private = self.private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                 serialization.NoEncryption()).decode()
        config = {"webPush": {"subject": "mailto:test@example.invalid", "privateKey": private,
                              "endpointKey": Fernet.generate_key().decode()}}
        conf = patch("core.integrations.push.configuration", return_value=config)
        conf.start()
        self.addCleanup(conf.stop)

    def post(self, resource, value):
        return self.client.post(self.base + "integrations/" + resource, value, content_type="application/json")

    def enroll(self):
        response = self.post("devices/" + self.device, {"endpoint": self.endpoint})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"enabled": True})

    def schedule(self):
        body = {"id": str(uuid4()), "at": (timezone.now() - timedelta(seconds=10)).isoformat(), "itemId": self.task}
        response = self.post("reminders", body)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["reminders"][0]["status"], "scheduled")
        return body

    def test_delivered_once_cancellation_and_idempotent_reminder(self):
        self.enroll()
        self.assertNotIn(self.endpoint, PushDevice.objects.get().endpoint)
        self.assertNotIn("http", str(self.client.get(self.base+"integrations/reminders").json()))
        body = self.schedule()
        self.assertEqual(self.post("reminders", body).status_code, 200)
        self.assertEqual(Reminder.objects.count(), 1)
        self.assertEqual(self.post("reminders", {**body, "at": timezone.now().isoformat()}).status_code, 409)
        with patch("core.integrations.transport.transaction", return_value=(201, b"")) as provider:
            self.assertTrue(jobs.run_one())
            self.assertTrue(jobs.run_one())
            self.assertFalse(jobs.run_one())
            provider.assert_called_once()
            method, url = provider.call_args.args
            self.assertEqual((method, url), ("POST", self.endpoint))
            header = provider.call_args.kwargs["headers"]["Authorization"]
            token = header.split("vapid t=")[1].split(", k=")[0]
            claims = jwt.decode(token, self.private_key.public_key(), algorithms=["ES256"],
                                audience="https://web.push.apple.com")
            self.assertEqual(claims["sub"], "mailto:test@example.invalid")
        row = self.client.get(self.base + "integrations/reminders").json()["reminders"][0]
        self.assertEqual((row["status"], row["delivery"]), ("due", "sent"))
        self.post("reminders", {"id": body["id"], "action": "cancel"})
        self.assertEqual(Reminder.objects.get().status, "cancelled")

    def test_ambiguous_crash_cannot_send_twice(self):
        self.enroll()
        self.schedule()
        jobs.run_one()
        job = jobs.claim()
        attempt, error = delivery.begin(job)
        self.assertEqual((attempt.status, error), ("sending", ""))
        # Model the persistent state after external acceptance but before receipt.
        Job.objects.filter(pk=job.pk).update(lease_until=timezone.now() - timedelta(seconds=5))
        with patch("core.integrations.push.send") as provider:
            self.assertTrue(jobs.run_one())
            provider.assert_not_called()
        self.assertEqual(ReminderDelivery.objects.get().status, "uncertain")
        self.assertFalse(jobs.finish(job))

    def test_provider_rejections_expiry_and_opt_out(self):
        self.enroll()
        self.schedule()
        jobs.run_one()
        with patch("core.integrations.push.send", side_effect=[429, 410]) as provider:
            self.assertTrue(jobs.run_one())
            self.assertEqual(ReminderDelivery.objects.get().status, "pending")
            Job.objects.filter(kind="reminder-push").update(next_attempt_at=timezone.now())
            self.assertTrue(jobs.run_one())
            self.assertEqual(provider.call_count, 2)
        self.assertFalse(PushDevice.objects.get().enabled)
        self.assertEqual(ReminderDelivery.objects.get().status, "expired")
        self.assertEqual(self.post("devices/" + self.device, {"endpoint": None}).json(), {"enabled": False})
        self.assertEqual(self.post("devices/" + self.device, {"endpoint": "https://unlisted.invalid/sub"}).status_code, 422)

    def test_worker_rechecks_task_and_member_and_hides_personal_state(self):
        self.enroll()
        body = self.schedule()
        self.command("complete", {"ids": [self.task]})
        jobs.run_one()
        self.assertEqual(Reminder.objects.get().status, "cancelled")
        self.assertFalse(ReminderDelivery.objects.exists())
        Membership.objects.create(workspace=self.space, user=self.other, role="viewer")
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.base + "integrations/reminders").json()["reminders"], [])
        self.assertFalse(self.client.get(self.base + "integrations/devices/" + self.device).json()["enabled"])
        self.assertEqual(self.post("devices/" + self.device, {"endpoint": self.endpoint}).status_code, 409)
        self.assertEqual(self.post("reminders", {"action":"cancel", "id": body["id"]}).status_code, 404)

    def test_cancel_before_dispatch_withdraw_membership_and_database_rewind(self):
        self.enroll()
        body = self.schedule()
        jobs.run_one()
        self.post("reminders", {"action": "cancel", "id": body["id"]})
        with patch("core.integrations.push.send") as provider:
            self.assertTrue(jobs.run_one())
            provider.assert_not_called()
        revoke_personal(self.space, self.owner)
        self.assertTrue(PushDevice.objects.get().enabled)
        Reminder.objects.update(status="scheduled")
        hold_after_restore()
        self.assertFalse(PushDevice.objects.get().enabled)
        self.assertEqual(Reminder.objects.get().status, "paused")
