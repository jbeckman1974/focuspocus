"""Evaluate inherited schedules once per item with the same clock as availability."""

from collections import defaultdict

from core.scheduling.dates import effective_dates, next_date_boundary


def schedules_for(rows, context):
    children = defaultdict(list)
    for row in rows:
        children[row["parentId"]].append(row)
    effective, defer = {}, {}
    boundary = None
    stack = [(row, {}, {}) for root in ("root", "inbox") for row in children[root]]
    while stack:
        row, dates, wire = stack.pop()
        key = row["id"]
        if row["schedule"]:
            dates = effective_dates(key, row["schedule"], dates, context)
            wire = {name: entry.wire() for name, entry in dates.items()}
            assigned = dates.get("defer")
            if assigned and assigned.source == key:
                defer[key] = assigned.instant
            next_change = next_date_boundary(dates, context)
            if next_change is not None and (boundary is None or next_change < boundary):
                boundary = next_change
        effective[key] = wire
        stack.extend((child, dates, wire) for child in children.get(key, ()))
    return effective, defer, boundary
