"""Advance or compensate a recurring occurrence inside the outline command transaction."""

from core.commands.validation import CommandError
from core.models import Item
from core.scheduling.clock import workspace_clock
from core.scheduling.recurrence import next_occurrence

from .models import Occurrence, RepeatSeries
from .templates import generate


def reject_historical_change(tree, item, desired):
    if desired != item.status and Occurrence.objects.filter(
        workspace=tree.workspace, item=item
    ).exclude(outcome="open").exists():
        raise CommandError("This occurrence is in the series history. Undo its resolution where available.", 409)


def advance(tree, result, item, outcome, now):
    record = Occurrence.objects.filter(workspace=tree.workspace, item=item).select_related("series").first()
    if record is None:
        return False
    if record.outcome != "open":
        raise CommandError("This occurrence was already resolved.", 409)
    series = record.series
    before = {"id": str(record.pk), "active": series.active, "remaining": series.remaining, "generated": None}
    context = workspace_clock(tree.workspace, now)
    plan = None
    if series.active:
        try:
            plan = next_occurrence(series.rule, item.schedule, context, remaining=series.remaining,
                                   origin=series.origin, skip=outcome == "skipped")
        except (ValueError, OverflowError) as error:
            raise CommandError(str(error)) from error
    record.outcome = outcome
    record.resolved_at = now
    record.applied_rule = series.rule if series.active else None
    record.save(update_fields=["outcome", "resolved_at", "applied_rule"])
    if plan is not None:
        before["generated"] = generate(tree, result, record, plan, context)
        series.remaining = plan.remaining
    elif series.active:
        series.active = False
        if series.remaining is not None and outcome != "skipped":
            series.remaining = max(0, series.remaining - 1)
    series.version += 1
    series.save(update_fields=["version", "remaining", "active"])
    result.inverse.setdefault("recurrences", []).append(before)
    return plan is not None


def undo_resolutions(tree, result, inverse):
    # The caller enforces the operation's post-state guard before removing clones.
    for prior in reversed(inverse.get("recurrences", [])):
        record = Occurrence.objects.select_related("series").get(workspace=tree.workspace, pk=prior["id"])
        batch = prior["generated"]
        if batch:
            keys = [batch["root"], *batch["children"]]
            generated = Item.objects.filter(workspace=tree.workspace, pk__in=keys)
            if generated.count() != len(keys):
                raise CommandError("The generated occurrence changed.", 409)
            generated.delete()
            RepeatSeries.objects.filter(workspace=tree.workspace, pk__in=batch["series"]).delete()
            result.versions.update({key: 0 for key in keys})
        record.outcome, record.resolved_at, record.applied_rule = "open", None, None
        record.save(update_fields=["outcome", "resolved_at", "applied_rule"])
        series = record.series
        series.active, series.remaining = prior["active"], prior["remaining"]
        series.version += 1
        series.save(update_fields=["active", "remaining", "version"])
