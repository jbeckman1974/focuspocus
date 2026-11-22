"""Common local-day, boundary and query validation for the planning views."""

from datetime import datetime, time, timedelta

from core.commands.validation import CommandError, due_date
from core.scheduling.dates import wall_instant


def allow_options(params, allowed):
    if set(params) - set(allowed) or any(len(params.getlist(key)) != 1 for key in params):
        raise CommandError("Unsupported or repeated planning option.", 400)


def boolean(params, key, default=False):
    if key not in params:
        return default
    if params[key] not in ("0", "1"):
        raise CommandError(f"Use 0 or 1 for {key}.", 400)
    return params[key] == "1"


def calendar_day(value):
    if not value:
        raise CommandError("Enter a calendar date in YYYY-MM-DD format.")
    return due_date(value)


def local_today(clock):
    return clock.now.astimezone(clock.zone).date()


def next_midnight(clock):
    tomorrow = local_today(clock) + timedelta(days=1)
    return wall_instant(datetime.combine(tomorrow, time.min), clock.zone)
