from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase

from core.commands.context import issue_context
from core.commands.service import execute
from core.commands.validation import CommandError
from core.models import Change, Item, Membership, Receipt, Workspace


class ConcurrentCommandTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username="test-concurrent-writes")
        self.workspace = Workspace.objects.create(private_owner=self.owner)
        Membership.objects.create(workspace=self.workspace, user=self.owner, role="owner")
        self.context = issue_context(self.workspace, self.owner)

    def capture(self):
        return {
            "context": self.context,
            "operationId": str(uuid4()),
            "expectedRevision": 0,
            "payload": {"parentId": "inbox", "items": [{"id": str(uuid4()), "title": "One task"}]},
        }

    def race(self, commands):
        start = Barrier(2, timeout=10)

        def run(body):
            try:
                user = get_user_model().objects.get(pk=self.owner.pk)
                start.wait()
                return 200, execute(user, self.workspace.pk, "capture", body)
            except CommandError as error:
                return error.status, str(error)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as workers:
            return list(workers.map(run, commands))

    def assert_one_commit(self):
        self.assertEqual(Item.objects.count(), 1)
        self.assertEqual(Change.objects.count(), 1)
        self.assertEqual(Receipt.objects.count(), 1)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.revision, 1)

    def test_same_operation_from_independent_connections_has_one_effect(self):
        envelope = self.capture()
        left, right = self.race([envelope, envelope])
        self.assertEqual(left[0], 200)
        self.assertEqual(left, right)
        self.assert_one_commit()

    def test_competing_commands_with_same_base_cannot_silently_overwrite(self):
        results = self.race([self.capture(), self.capture()])
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        self.assert_one_commit()
