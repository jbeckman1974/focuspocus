from django.core.management.base import BaseCommand, CommandError

from core.sync.jobs import heartbeat_fresh


class Command(BaseCommand):
    help = "Check the database heartbeat for this worker instance."

    def handle(self, *args, **options):
        if not heartbeat_fresh():
            raise CommandError("Worker heartbeat is absent or stale.")
