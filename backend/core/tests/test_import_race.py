from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from django.db import connections, transaction
from django.test import TransactionTestCase

from core.commands.service import scoped_workspace
from core.imports.models import ImportBatch, ImportMapping
from core.imports.staging import stage
from core.imports.views import transition
from core.models import Change, Item
from core.tests.outline_case import OutlineApiMixin


class ImportRaceTests(OutlineApiMixin, TransactionTestCase):
    def test_simultaneous_commit_retry_appends_only_once(self):
        with transaction.atomic():
            space = scoped_workspace(self.owner, self.space.pk, owner=True)
            pending = stage(space, b"- One import", "taskpaper")
        envelope = {"context": self.context, "operationId": str(uuid4()), "expectedRevision": 0}
        ready = Barrier(2, timeout=10)

        def submit(_):
            try:
                ready.wait()
                with transaction.atomic():
                    locked = scoped_workspace(self.owner, self.space.pk, owner=True)
                    batch = ImportBatch.objects.get(workspace=locked, pk=pending.pk)
                    return transition(self.owner, locked, batch, "commit", envelope).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(submit, range(2))), [200, 200])
        self.assertEqual(Item.objects.filter(workspace=self.space).count(), 1)
        self.assertEqual(ImportMapping.objects.filter(workspace=self.space).count(), 1)
        self.assertEqual(Change.objects.filter(workspace=self.space).count(), 1)
