"""Copy recurrence settings independently and generate a new scheduled subtree."""

from core.commands.state import Changes, save_changed
from core.rules.properties import status_updates
from core.scheduling.recurrence import anchor_field, clock_zone, shifted_dates
from core.scheduling.repeat_rule import RepeatRule
from core.scheduling.dates import direct_dates
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
    dates = direct_dates(root.schedule)
    rule = RepeatRule.from_wire(record.series.rule)
    anchor = anchor_field(rule, dates)
    zone = clock_zone(dates[anchor], context)
    old = dates[anchor].instant(anchor, context)
    new = direct_dates(plan.schedule)[anchor].instant(anchor, context)
    target = clones.pop(root.pk)
    save_changed(target, copied, **status_updates("active"), **schedule_updates(plan.schedule))
    for child in clones.values():
        properties = status_updates("active") if child.status in {"completed", "dropped"} else {}
        if child.schedule:
            shifted = shifted_dates(direct_dates(child.schedule), old, new, zone, context,
                                    subday=rule.unit in ("minute", "hour"))
            properties.update(schedule_updates(shifted))
        save_changed(child, copied, **properties)
    nested = copy_series(tree, clones)
    Occurrence.objects.create(workspace=tree.workspace, item=target, series=record.series, predecessor=record)
    result.versions.update(copied.versions)
    return {"root": str(target.pk), "children": [str(row.pk) for row in clones.values()], "series": nested}
