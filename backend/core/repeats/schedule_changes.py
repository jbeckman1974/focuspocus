"""Keep an active series compatible with intentional edits to its current dates."""

from core.commands.validation import CommandError
from core.scheduling.recurrence import anchor_field, next_occurrence
from core.scheduling.repeat_rule import RepeatRule
from core.scheduling.storage import read_schedule

from .models import Occurrence


def validate_rule_schedule(rule, schedule, context, origin):
    # Check both the template and frequency even when one remaining completion
    # would otherwise finish the series without calculating a future date.
    sample = next_occurrence(rule, schedule, context, origin=origin, remaining=2)
    if sample is None and rule.end_date is None:
        raise ValueError("This pattern has no future calendar occurrence.")


def rebase_active_schedule(item, proposed, context):
    current = read_schedule(item)
    if proposed == current:
        return
    record = Occurrence.objects.filter(
        workspace_id=item.workspace_id, item=item, outcome="open", series__active=True
    ).select_related("series").first()
    if record is None:
        return
    series = record.series
    try:
        rule = RepeatRule.from_wire(series.rule)
        old_anchor, new_anchor = anchor_field(rule, current), anchor_field(rule, proposed)
        origin = series.origin
        if old_anchor != new_anchor or current[old_anchor] != proposed[new_anchor] or new_anchor not in origin:
            origin = proposed
        validate_rule_schedule(rule, proposed, context, origin)
    except (ValueError, OverflowError) as error:
        raise CommandError(f"{error} Change or stop the repeat rule before removing its required date or time.") from error
    series.origin = origin
    series.version += 1
    series.save(update_fields=["origin", "version"])
