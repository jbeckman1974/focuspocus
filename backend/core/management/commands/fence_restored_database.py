import uuid

from django.contrib.sessions.models import Session
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core.integrations.membership import hold_after_restore
from core.models import Job, PasswordRecovery, Receipt, WorkerHeartbeat, Workspace
from core.oidc.models import LoginChallenge


class Command(BaseCommand):
    help = "Fence an isolated restored database before web and worker processes start."

    @transaction.atomic
    def handle(self, *args, **options):
        count = 0
        for workspace in Workspace.objects.select_for_update().only("pk").order_by("pk").iterator():
            workspace.generation = uuid.uuid4()
            workspace.save(update_fields=["generation"])
            count += 1
        # Legacy completion inverses do not identify their original database
        # generation. Keep their receipts but retire compensation across restoration.
        Receipt.objects.exclude(inverse={}).filter(inverse__journal__isnull=True).update(inverse={})
        Session.objects.all().delete()
        LoginChallenge.objects.all().delete()
        PasswordRecovery.objects.all().delete()
        WorkerHeartbeat.objects.all().delete()
        quarantined = Job.objects.filter(status__in=["pending", "running"]).update(
            status="failed", last_error="restore_reconciliation", finished_at=timezone.now(),
            lease_until=None, lease_token=None,
        )
        hold_after_restore()
        self.stdout.write(f"Rotated {count} workspace generations and held {quarantined} jobs.")
