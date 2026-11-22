import io
import socket
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from core.models import Job, Membership, WorkerHeartbeat, Workspace
from core.sync import jobs


def setup_probe():
    actor = get_user_model().objects.create_user(username="worker-fixture")
    space = Workspace.objects.create(private_owner=actor)
    Membership.objects.create(user=actor, workspace=space, role="owner")
    return actor, space


class WorkerTests(TestCase):
    def setUp(self):
        self.actor, self.space = setup_probe()
        self.key = uuid.uuid4()
        self.job = jobs.enqueue_probe(self.actor, self.space.pk, self.key)

    def test_cli_idempotency_heartbeat_and_single_run(self):
        output = io.StringIO()
        call_command("queue_probe", str(self.space.pk), self.actor.username, str(self.key), stdout=output)
        self.assertEqual(output.getvalue().strip(), str(self.job.pk))
        with self.assertRaises(CommandError):
            call_command("worker_health")
        call_command("runworker", once=True)
        call_command("worker_health")
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, self.job.attempts), ("done", 1))
        self.assertIsNotNone(self.job.finished_at)
        self.assertFalse(jobs.run_one())
        WorkerHeartbeat.objects.filter(name=socket.gethostname()).update(updated_at=timezone.now() - timedelta(minutes=2))
        with self.assertRaises(CommandError):
            call_command("worker_health")

    def test_recheck_current_authority(self):
        Membership.objects.filter(user=self.actor).delete()
        with self.assertRaises(ValueError):
            jobs.enqueue_probe(self.actor, self.space.pk, uuid.uuid4())
        self.assertTrue(jobs.run_one())
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, self.job.last_error), ("failed", "authorization_revoked"))

    def test_crashed_claim_restores_only_the_new_lease(self):
        abandoned = jobs.claim()
        self.assertIsNone(jobs.claim())
        Job.objects.filter(pk=abandoned.pk).update(lease_until=timezone.now() - timedelta(seconds=1))
        replacement = jobs.claim()
        self.assertEqual((replacement.pk, replacement.attempts), (abandoned.pk, 2))
        self.assertNotEqual(replacement.lease_token, abandoned.lease_token)
        self.assertFalse(jobs.finish(abandoned))
        self.assertTrue(jobs.finish(replacement))
        self.assertFalse(jobs.finish(replacement))
        self.assertFalse(jobs.run_one())

    def test_transient_job_failure_is_bounded_and_code_only(self):
        with patch("core.sync.jobs.execute", side_effect=OperationalError):
            for attempt in range(1, jobs.MAX_ATTEMPTS + 1):
                Job.objects.filter(pk=self.job.pk).update(next_attempt_at=timezone.now())
                self.assertTrue(jobs.run_one())
                self.assertFalse(jobs.run_one())
                self.job.refresh_from_db()
                self.assertEqual(self.job.attempts, attempt)
                self.assertEqual(self.job.status, "failed" if attempt == jobs.MAX_ATTEMPTS else "pending")
                self.assertEqual(self.job.last_error, "database_unavailable")

    def test_unknown_handler_or_exhausted_lease_is_terminal(self):
        Job.objects.filter(pk=self.job.pk).update(kind="unsupported")
        self.assertTrue(jobs.run_one())
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, self.job.last_error), ("failed", "unknown_job"))
        Job.objects.filter(pk=self.job.pk).update(
            status="running", lease_token=uuid.uuid4(),
            attempts=jobs.MAX_ATTEMPTS, lease_until=timezone.now() - timedelta(seconds=4),
        )
        self.assertTrue(jobs.run_one())
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, self.job.last_error), ("failed", "lease_exhausted"))


class WorkerRaceTests(TransactionTestCase):
    def test_two_processes_claim_one_job_once(self):
        actor, space = setup_probe()
        job = jobs.enqueue_probe(actor, space.pk, uuid.uuid4())
        barrier = Barrier(2)

        def poll():
            try:
                barrier.wait(timeout=10)
                return jobs.run_one()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = [executor.submit(poll) for _ in range(2)]
            self.assertEqual(sorted(f.result(timeout=15) for f in results), [False, True])
        job.refresh_from_db()
        self.assertEqual((job.status, job.attempts), ("done", 1))
