import signal
import threading
from time import monotonic

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from core.sync.health import schema_ready
from core.sync.jobs import heartbeat, run_one
from core.sync.retention import BATCH_SIZE, prune_batch


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
            prune_batch()
            return
        stopped = threading.Event()
        previous = {
            sig: signal.signal(sig, lambda *_: stopped.set())
            for sig in (signal.SIGINT, signal.SIGTERM)
        }
        next_prune = 0
        try:
            while not stopped.is_set():
                close_old_connections()
                heartbeat()
                if monotonic() >= next_prune:
                    counts = prune_batch()
                    next_prune = monotonic() + (2 if max(counts) == BATCH_SIZE else 300)
                if not run_one():
                    stopped.wait(timeout=2)
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
