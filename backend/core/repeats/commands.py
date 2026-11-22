"""Configure and control a single series after workspace authorization and version checks."""

from datetime import datetime

from django.utils import timezone

from core.commands.completion import apply_status
from core.commands.state import Changes, save_changed
from core.commands.validation import CommandError, fields, identifier
from .schedule_changes import validate_rule_schedule
from core.scheduling.repeat_rule import RepeatRule

from .models import Occurrence, RepeatSeries
from core.scheduling.clock import workspace_clock


COMMANDS = {"set-repeat", "skip-occurrence", "stop-series", "set-completion-time"}


def require_version(record, data):
    version = data.get("seriesVersion")
    if type(version) is not int or version != record.series.version:
        raise CommandError("The series changed. Reload it before editing.", 409)


def set_repeat(tree, item, record, data):
    if item.kind == "folder" or item.status in {"completed", "dropped"}:
        raise CommandError("Choose an unresolved action, group or project.")
    if record is None and "seriesVersion" in data:
        raise CommandError("The specified series is unavailable.", 409)
    try:
        rule = RepeatRule.from_wire(data["rule"])
        validate_rule_schedule(rule, item.schedule, workspace_clock(tree.workspace), item.schedule)
    except (ValueError, OverflowError) as error:
        raise CommandError(str(error)) from error
    if record is None:
        series = RepeatSeries.objects.create(workspace=tree.workspace, rule=data["rule"], origin=item.schedule,
                                             remaining=rule.count)
        Occurrence.objects.create(workspace=tree.workspace, item=item, series=series)
    else:
        series = record.series
        if record.outcome != "open":
            raise CommandError("Edit the current occurrence.", 409)
        if series.rule == data["rule"] and series.active:
            return False
        # An unchanged ending retains the actual number left in the series.
        if series.rule.get("count") != rule.count:
            series.remaining = rule.count
        series.origin = item.schedule
        series.rule = data["rule"]
        series.active = True
        series.version += 1
        series.save(update_fields=["origin", "rule", "remaining", "active", "version"])
    return True


def touch_rule_item(item, result):
    item.version += 1
    item.changed_at = timezone.now()
    item.save(update_fields=["version", "changed_at"])
    result.touch(item)


def edit_completion_time(record, item, result, text):
    if record.outcome != "completed" or not isinstance(text, str) or len(text) > 40:
        raise CommandError("Choose a completed occurrence and an explicit ISO timestamp.")
    try:
        value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise CommandError("Use an ISO timestamp with a timezone.") from error
    if value.utcoffset() is None:
        raise CommandError("Use a timestamp with a timezone.")
    if record.resolved_at == value:
        return
    record.resolved_at = value
    record.save(update_fields=["resolved_at"])
    save_changed(item, result, completed_at=value)
    record.series.version += 1
    record.series.save(update_fields=["version"])


def dispatch(tree, name, data):
    required = ["id", "rule"] if name == "set-repeat" else ["id", "seriesVersion"]
    if name == "set-completion-time":
        required.append("completedAt")
    fields(data, required, ["seriesVersion"] if name == "set-repeat" else [])
    item = tree.get(identifier(data["id"]))
    record = Occurrence.objects.select_related("series").filter(workspace=tree.workspace, item=item).first()
    if record is not None:
        require_version(record, data)
    elif name != "set-repeat":
        raise CommandError("This item has no repeat series.", 404)
    result = Changes([str(item.pk)])
    if name == "set-repeat":
        if set_repeat(tree, item, record, data):
            touch_rule_item(item, result)
    elif name == "set-completion-time":
        edit_completion_time(record, item, result, data["completedAt"])
    else:
        if record.outcome != "open" or not record.series.active:
            raise CommandError("Choose the current occurrence of an active series.", 409)
        if name == "skip-occurrence":
            apply_status(tree, result, [item], "dropped", skip=True)
            if not result.versions:
                raise CommandError("Reopen the resolved parent before skipping this occurrence.", 409)
        else:
            record.series.active = False
            record.series.version += 1
            record.series.save(update_fields=["active", "version"])
            touch_rule_item(item, result)
    return result
