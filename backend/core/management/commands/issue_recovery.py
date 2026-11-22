from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.auth_services import issue_recovery


class Command(BaseCommand):
    help = "Issue a one-time, 15-minute password recovery token for verified out-of-band delivery."

    def add_arguments(self, parser):
        parser.add_argument("username")

    def handle(self, *args, **options):
        try:
            token = issue_recovery(options["username"])
        except get_user_model().DoesNotExist:
            raise CommandError("No active account with that username.") from None
        self.stdout.write(token)
