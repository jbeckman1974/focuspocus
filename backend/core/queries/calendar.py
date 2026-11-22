"""Evaluate inherited schedules once per item with the same clock as availability."""

from collections import defaultdict

from core.scheduling.dates import DateIntent, effective_dates, next_date_boundary
from core.scheduling.storage import read_schedule


def schedules_for(items, context):
    children = defaultdict(list)
    for item in items:
        children[item.parent_id].append(item)
    direct, effective, defer = {}, {}, {}
    boundary = None
    stack = [(root, {}) for root in children[None]]
    while stack:
        item, inherited = stack.pop()
        key = str(item.pk)
        direct[key] = read_schedule(item)
        assigned = direct[key].get("defer")
        if assigned:
            defer[key] = DateIntent.from_wire(assigned).instant("defer", context)
        dates = effective_dates(key, direct[key], inherited, context)
        effective[key] = {name: entry.wire() for name, entry in dates.items()}
        next_change = next_date_boundary(dates, context)
        if next_change is not None and (boundary is None or next_change < boundary):
            boundary = next_change
        stack.extend((child, dates) for child in children[item.pk])
    return direct, effective, defer, boundary
