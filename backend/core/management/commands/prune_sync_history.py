from django.core.management.base import BaseCommand, CommandError

from core.sync.retention import BATCH_SIZE, prune_batch


class Command(BaseCommand):
    help = "Prune one bounded batch of expired sync receipts and changes."

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)

    def handle(self, *args, **options):
        try:
            receipts, changes = prune_batch(limit=options["batch_size"])
        except ValueError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(f"Pruned {receipts} receipts and {changes} changes.")
