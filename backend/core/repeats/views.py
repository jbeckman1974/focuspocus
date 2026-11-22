"""Preview an editor's proposed series using a consistent, private workspace read."""

from datetime import datetime

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_POST

from core.commands.service import scoped_workspace
from core.commands.state import Outline
from core.commands.validation import CommandError, fields, identifier
from core.commands.views import read_body
from core.scheduling.recurrence import next_occurrence

from .models import Occurrence
from core.scheduling.clock import workspace_clock


@never_cache
@require_POST
def preview(request, workspace_id):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id)
            data = fields(read_body(request), ["id", "rule"], ["completedAt"])
            item = Outline(workspace).get(identifier(data["id"]))
            context = workspace_clock(workspace)
            completed = context.now
            if "completedAt" in data:
                text = data["completedAt"]
                if not isinstance(text, str) or len(text) > 40:
                    raise ValueError("Use a completion timestamp with a timezone.")
                completed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            record = Occurrence.objects.select_related("series").filter(workspace=workspace, item=item).first()
            original, remaining = None, None
            if record is not None and record.outcome == "open" and record.series.rule == data["rule"]:
                original, remaining = record.series.origin, record.series.remaining
            plan = next_occurrence(data["rule"], item.schedule, context, completed_at=completed,
                                   origin=original, remaining=remaining)
            return JsonResponse({"revision": workspace.revision, "next": plan.schedule if plan else None,
                                 "remaining": plan.remaining if plan else 0})
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
    except (ValueError, OverflowError):
        return JsonResponse({"error": "The proposed dates and repeat rule cannot produce this preview."}, status=422)
