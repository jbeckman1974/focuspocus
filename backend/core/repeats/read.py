from .models import Occurrence


def repeat_states(workspace):
    records = Occurrence.objects.filter(workspace=workspace, item__workspace=workspace, item__shelf="active").select_related(
        "series", "predecessor", "successor"
    )
    result = {}
    for record in records:
        previous = record.predecessor
        successor = getattr(record, "successor", None)
        result[str(record.item_id)] = {
            "seriesId": str(record.series_id), "seriesVersion": record.series.version,
            "active": record.series.active, "rule": record.applied_rule or record.series.rule,
            "remaining": record.series.remaining, "outcome": record.outcome,
            "resolvedAt": record.resolved_at.isoformat() if record.resolved_at else None,
            "predecessorId": str(previous.item_id) if previous else None,
            "successorId": str(successor.item_id) if successor else None,
        }
    return result
