from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.sync.jobs import enqueue_probe


class Command(BaseCommand):
    help = "Queue an idempotent, authorized workspace revision probe."

    def add_arguments(self, parser):
        parser.add_argument("workspace", type=UUID)
        parser.add_argument("actor")
        parser.add_argument("dedupe", type=UUID)

    def handle(self, *args, **options):
        actor = get_user_model().objects.filter(username=options["actor"], is_active=True).first()
        if actor is None:
            raise CommandError("Unknown authorized actor/workspace pair")
        try:
            job = enqueue_probe(actor, options["workspace"], options["dedupe"])
        except ValueError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(str(job.pk))
