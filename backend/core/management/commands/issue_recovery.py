import os
from contextlib import contextmanager
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.auth_services import issue_recovery


@contextmanager
def destination(filename):
    if not filename:
        with open("/dev/tty", "w", encoding="ascii") as terminal:
            if not terminal.isatty():
                raise CommandError("A controlling terminal or --output-file is required.")
            yield terminal
        return

    path = Path(filename)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    created = os.fstat(fd)
    try:
        with os.fdopen(fd, "w", encoding="ascii") as stream:
            yield stream
    except BaseException:
        # Never remove a replacement installed by another process.
        try:
            if os.path.samestat(path.lstat(), created):
                path.unlink()
        except FileNotFoundError:
            pass
        raise


class Command(BaseCommand):
    help = "Issue a 15-minute recovery token to the controlling tty or a new private file."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--output-file", help="Create a new owner-only file for the token.")

    def handle(self, *args, **options):
        filename = options["output_file"]
        try:
            with destination(filename) as output, transaction.atomic():
                token = issue_recovery(options["username"])
                output.write(token + "\n")
                output.flush()
                if filename:
                    os.fsync(output.fileno())
        except get_user_model().DoesNotExist:
            raise CommandError("No active account with that username.") from None
        except OSError as error:
            raise CommandError("Could not deliver the token. Use a tty or a new private file.") from error
        self.stdout.write("Recovery token issued for verified out-of-band delivery.")
