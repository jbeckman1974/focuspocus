from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase

from core.commands.service import execute
from core.commands.validation import CommandError
from core.models import Change, Item
from core.repeats.models import Occurrence

from .outline_case import OutlineApiMixin


class SeriesCompletionRace(OutlineApiMixin, TransactionTestCase):
    def test_competing_completion_and_lost_ack_have_one_resolution_and_successor(self):
        item, = self.capture(["Daily battery"])
        self.command("bulk-edit", {"ids": [item], "due": "2026-11-18"})
        self.command("set-repeat", {"id": item, "rule": {"schedule": "regular", "unit": "day"}})
        left = self.envelope({"ids": [item]})
        right = {**left, "operationId": str(uuid4())}
        before = Change.objects.count()
        gate = Barrier(2, timeout=10)

        def submit(body):
            try:
                user = get_user_model().objects.get(pk=self.owner.pk)
                gate.wait()
                return 200, execute(user, self.space.pk, "complete", body)
            except CommandError as error:
                return error.status, None
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as threads:
            replies = list(threads.map(submit, [left, right]))
        self.assertEqual(sorted(status for status, _ in replies), [200, 409])
        winner = next(i for i, (status, _) in enumerate(replies) if status == 200)
        retried = self.send("complete", [left, right][winner])
        self.assertEqual(retried.json(), replies[winner][1])
        self.assertEqual(Occurrence.objects.filter(outcome="completed").count(), 1)
        self.assertEqual(Occurrence.objects.filter(predecessor__isnull=False).count(), 1)
        self.assertEqual(Item.objects.count(), 2)
        self.assertEqual(Change.objects.count(), before + 1)
