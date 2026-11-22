from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connections, transaction
from django.test import TransactionTestCase

from core.commands.validation import CommandError
from core.models import Change, Item, Membership, Receipt, Workspace
from core.sharing import capture, members
from core.sharing.models import SharedWorkspace


class SharedWriteRaceTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username="race-owner")
        self.actor = get_user_model().objects.create_user(username="race-teammate")
        self.space = Workspace.objects.create()
        SharedWorkspace.objects.create(workspace=self.space, name="Shared planning")
        Membership.objects.create(user=self.owner, workspace=self.space, role="owner")

    def race(self, actions):
        ready = Barrier(len(actions), timeout=10)

        def run(action):
            try:
                ready.wait()
                with transaction.atomic():
                    return 200, action()
            except CommandError as error:
                return error.status, None
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(actions)) as pool:
            return list(pool.map(run, actions))

    def test_concurrent_redeem_creates_one_membership_and_change(self):
        with transaction.atomic():
            invite = members.issue_invitation(self.owner, self.space.pk, {
                "username": self.actor.username, "role": "editor", "expectedVersion": 0,
            })

        def accept():
            return members.accept_invitation(self.actor, {"token": invite["token"]})

        result = self.race([accept, accept])
        self.assertEqual(sorted(status for status, _ in result), [200, 404])
        self.assertEqual(Membership.objects.filter(workspace=self.space, user=self.actor).count(), 1)
        self.assertEqual(Change.objects.filter(workspace=self.space).count(), 1)

    def test_independent_calls_retry_same_capture_once(self):
        Membership.objects.create(user=self.actor, workspace=self.space, role="editor")
        with transaction.atomic():
            grant = capture.own_credentials(self.actor, self.space.pk, {"label": "Offline field device"})
        header = "Bearer " + grant["token"]
        context = capture.issue_context(header, {})["context"]
        request = {"context": context, "operationId": str(uuid4()), "title": "Race capture"}

        def submit():
            return capture.capture(header, request)

        first, second = self.race([submit, submit])
        self.assertEqual(first[0], 200)
        self.assertEqual(second, first)
        self.assertEqual(Item.objects.filter(workspace=self.space).count(), 1)
        self.assertEqual(Receipt.objects.filter(workspace=self.space).count(), 1)
        self.assertEqual(Change.objects.filter(workspace=self.space).count(), 1)

    def test_capture_rechecks_grant_after_waiting_for_a_revocation(self):
        Membership.objects.create(user=self.actor, workspace=self.space, role="editor")
        with transaction.atomic():
            grant = capture.own_credentials(self.actor, self.space.pk, {"label": "Race device"})
        header = "Bearer " + grant["token"]
        context = capture.issue_context(header, {})["context"]
        request = {"context": context, "operationId": str(uuid4()), "title": "Stale capture"}
        waiting = Event()

        def submit():
            def observe(execute, sql, params, many, db_context):
                if "FOR UPDATE" in sql:
                    waiting.set()
                return execute(sql, params, many, db_context)

            try:
                with connections["default"].execute_wrapper(observe):
                    capture.capture(header, request)
            except CommandError as error:
                return error.status
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                capture.revoke_credential(self.actor, self.space.pk, grant["id"], {})
                reader = pool.submit(submit)
                self.assertTrue(waiting.wait(timeout=10))
            self.assertEqual(reader.result(timeout=10), 401)
        self.assertFalse(Item.objects.filter(workspace=self.space).exists())
