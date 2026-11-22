import signal
import threading

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from core.sync.health import schema_ready
from core.sync.jobs import heartbeat, run_one


class Command(BaseCommand):
    help = "Process durable workspace jobs from the migrated database."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Poll once, then exit.")

    def handle(self, *args, **options):
        if not schema_ready():
            raise CommandError("Database schema is incompatible.")
        if options["once"]:
            heartbeat()
            run_one()
            return
        stopped = threading.Event()
        previous = {
            sig: signal.signal(sig, lambda *_: stopped.set())
            for sig in (signal.SIGINT, signal.SIGTERM)
        }
        try:
            while not stopped.is_set():
                close_old_connections()
                heartbeat()
                if not run_one():
                    stopped.wait(timeout=2)
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
