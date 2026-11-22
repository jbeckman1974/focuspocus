"""Find the next matching calendar day by jumping to its active period."""

import calendar
from datetime import date


def month_days(rule, year, month, original_day):
    last = calendar.monthrange(year, month)[1]
    if rule.month_days:
        return sorted({last if day == -1 else day for day in rule.month_days if day <= last})
    if rule.ordinal:
        days = [day for day in range(1, last + 1) if date(year, month, day).weekday() in rule.ordinal_days]
        index = rule.ordinal - 1 if rule.ordinal > 0 else rule.ordinal
        return [days[index]] if -len(days) <= index < len(days) else []
    return [min(original_day, last)]


def month_number(day):
    return (day.year - 1) * 12 + day.month - 1


def month_slots(rule, origin, floor):
    step = rule.interval * (12 if rule.unit == "year" else 1)
    start = month_number(origin)
    block = max(0, (month_number(floor) - start) // step)
    # The Gregorian calendar repeats every 400 years; a phase with no valid
    # allowed position over one cycle cannot have a later match.
    for offset in range(4801):
        year_offset, month_offset = divmod(start + (block + offset) * step, 12)
        if year_offset >= 9999:
            return
        for day in month_days(rule, year_offset + 1, month_offset + 1, origin.day):
            match = date(year_offset + 1, month_offset + 1, day)
            if match >= max(origin, floor):
                yield match


def date_slots(rule, origin, floor):
    if rule.unit in ("month", "year"):
        yield from month_slots(rule, origin, floor)
        return
    step = rule.interval * (7 if rule.unit == "week" else 1)
    start = origin.toordinal()
    positions = (0,)
    if rule.weekdays:
        start -= origin.weekday()
        positions = rule.weekdays
    block = max(0, (floor.toordinal() - start) // step)
    cursor = start + block * step
    minimum = max(origin, floor).toordinal()
    while cursor <= date.max.toordinal():
        for offset in positions:
            ordinal = cursor + offset
            if minimum <= ordinal <= date.max.toordinal():
                yield date.fromordinal(ordinal)
        cursor += step
