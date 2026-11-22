from getpass import getpass
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError

from core.auth_services import provision_account


class Command(BaseCommand):
    help = "Create an ordinary account and its empty private workspace."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--password-file", help="Read a secret from a mounted file or /dev/stdin.")

    def handle(self, *args, **options):
        filename = options["password_file"]
        password = Path(filename).read_text().rstrip("\r\n") if filename else getpass("Password: ")
        if not filename and password != getpass("Confirm password: "):
            raise CommandError("Passwords differ.")
        try:
            provision_account(options["username"], password)
        except ValidationError as error:
            raise CommandError(" ".join(error.messages)) from None
        except IntegrityError:
            raise CommandError("The account could not be created.") from None
        self.stdout.write("Account and private workspace created.")
