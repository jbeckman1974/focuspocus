"""Advance project review dates in calendar units, clipping to the target month."""

from calendar import monthrange
from datetime import date, timedelta

from core.commands.validation import CommandError


def advance(day, interval, unit):
    try:
        if unit in ("day", "week"):
            return day + timedelta(days=interval * (7 if unit == "week" else 1))
        month_index = day.year * 12 + day.month - 1 + interval * (12 if unit == "year" else 1)
        year, month_index = divmod(month_index, 12)
        month = month_index + 1
        return date(year, month, min(day.day, monthrange(year, month)[1]))
    except (OverflowError, ValueError) as error:
        raise CommandError("The review would fall beyond the supported calendar.") from error
