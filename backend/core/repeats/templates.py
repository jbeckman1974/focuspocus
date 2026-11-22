"""Copy recurrence settings independently and generate a new scheduled subtree."""

from core.commands.state import Changes, save_changed
from core.rules.properties import status_updates
from core.scheduling.recurrence import as_intent, clock_zone
from core.scheduling.dates import direct_dates, wall_instant
from core.scheduling.storage import legacy_due_value

from .models import Occurrence, RepeatSeries


def copy_series(tree, copies):
    series_ids = []
    records = Occurrence.objects.filter(workspace=tree.workspace, item_id__in=copies).select_related("series")
    for record in records:
        target = copies[record.item_id]
        template = record.applied_rule or record.series.rule
        series = RepeatSeries.objects.create(
            workspace=tree.workspace, rule=template, origin=target.schedule,
            remaining=template.get("count"), active=record.series.active or record.applied_rule is not None,
        )
        outcome = target.status if target.status in {"completed", "dropped"} else "open"
        Occurrence.objects.create(workspace=tree.workspace, series=series, item=target, outcome=outcome,
                                  resolved_at=target.completed_at or target.dropped_at,
                                  applied_rule=template if outcome != "open" else None)
        series_ids.append(str(series.pk))
    return series_ids


def shifted_child(schedule, delta, context):
    shifted = {}
    for field, value in direct_dates(schedule).items():
        zone = clock_zone(value, context)
        wall = value.instant(field, context).astimezone(zone).replace(tzinfo=None) + delta
        shifted[field] = as_intent(value, wall_instant(wall, zone, value.fold), context).wire()
    return shifted


def schedule_updates(schedule):
    return {"schedule": schedule, "due": legacy_due_value(schedule)}


def generate(tree, result, record, plan, context):
    from core.commands.shelves import copy_subtree, subtree
    from core.commands.structure import Layout

    root = tree.get(record.item_id)
    layout = Layout(tree, [root])
    copied = Changes([])
    clones = copy_subtree(tree, subtree(layout.children, root), root.parent_id, copied,
                          duplicate=True, repeat_successor=True)
    anchor = next(key for key in ("due", "planned", "defer") if key in root.schedule)
    old = direct_dates(root.schedule)[anchor]
    new = direct_dates(plan.schedule)[anchor]
    zone = clock_zone(old, context)
    delta = (new.instant(anchor, context).astimezone(zone).replace(tzinfo=None)
             - old.instant(anchor, context).astimezone(zone).replace(tzinfo=None))
    target = clones.pop(root.pk)
    save_changed(target, copied, **status_updates("active"), **schedule_updates(plan.schedule))
    for child in clones.values():
        properties = status_updates("active") if child.status in {"completed", "dropped"} else {}
        if child.schedule:
            properties.update(schedule_updates(shifted_child(child.schedule, delta, context)))
        save_changed(child, copied, **properties)
    nested = copy_series(tree, clones)
    Occurrence.objects.create(workspace=tree.workspace, item=target, series=record.series, predecessor=record)
    result.versions.update(copied.versions)
    return {"root": str(target.pk), "children": [str(row.pk) for row in clones.values()], "series": nested}
