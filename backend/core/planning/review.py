"""Read a private review queue and update its project schedules under the command lock."""

from core.commands.state import Changes
from core.commands.validation import CommandError, fields, identifier
from core.models import Item
from core.perspectives.focus import focused_ids
from core.scheduling.clock import workspace_clock

from .cadence import advance
from .calendar import allow_options, calendar_day, local_today, next_midnight
from .models import ProjectReview, UNITS


def initial_review(project, workspace, clock):
    # Migration 0009 materializes dates for older rows without a known creation time.
    created = (project.created_at or clock.now).astimezone(clock.zone).date()
    return ProjectReview(project_id=project.pk, workspace=workspace, interval=1, unit="week",
                         next_review=advance(created, 1, "week"), version=0)


def describe(project, review):
    return {
        "projectId": str(project.pk), "title": project.title, "status": project.status,
        "interval": review.interval, "unit": review.unit, "nextReview": review.next_review.isoformat(),
        "lastReviewedAt": review.last_reviewed_at.isoformat() if review.last_reviewed_at else None,
        "lastReviewedBy": str(review.last_actor_id) if review.last_actor_id is not None else None,
        "version": review.version,
    }


def queue(workspace, user, params):
    allow_options(params, {"scope"})
    scope = params.get("scope", "due")
    if scope not in ("due", "all"):
        raise CommandError("Choose due or all projects.", 400)
    clock = workspace_clock(workspace)
    today = local_today(clock)
    library = list(Item.objects.filter(workspace=workspace, shelf="active", kind__in=("project", "folder"))
                   .select_related("projectreview").order_by("position", "id"))
    focus = focused_ids(workspace, user, [
        {"id": str(item.pk), "parentId": str(item.parent_id) if item.parent_id else "root"} for item in library])
    projects = []
    for project in library:
        if project.kind != "project" or project.status not in ("active", "held"):
            continue
        if focus is not None and str(project.pk) not in focus:
            continue
        review = getattr(project, "projectreview", None) or initial_review(project, workspace, clock)
        if scope == "all" or review.next_review <= today:
            projects.append(describe(project, review))
    projects.sort(key=lambda row: (row["nextReview"], row["title"].casefold(), row["projectId"]))
    return {"workspaceId": str(workspace.pk), "revision": workspace.revision, "today": today.isoformat(),
            "viewZone": clock.zone.key, "nextDateBoundary": next_midnight(clock).isoformat(), "projects": projects}


def command(tree, user, name, payload):
    allowed = ["expectedVersion"]
    if name == "set-review":
        allowed.extend(("interval", "unit", "nextReview"))
    fields(payload, ["projectId"], allowed)
    project = tree.get(identifier(payload["projectId"]))
    if project.kind != "project":
        raise CommandError("Choose a project to review.")
    clock = workspace_clock(tree.workspace)
    review = (ProjectReview.objects.filter(workspace=tree.workspace, project=project).first()
              or initial_review(project, tree.workspace, clock))
    if "expectedVersion" in payload:
        version = payload["expectedVersion"]
        if type(version) is not int or version < 0:
            raise CommandError("Expected a nonnegative review version.")
        if review.version != version:
            raise CommandError("This project's review has changed.", 409)
    result = Changes([str(project.pk)])
    if name == "mark-reviewed":
        if project.status not in ("active", "held"):
            raise CommandError("Reopen the project before marking it reviewed.")
        review.next_review = advance(local_today(clock), review.interval, review.unit)
        review.last_reviewed_at = clock.now
        review.last_actor = user
    else:
        updates = set(payload) & {"interval", "unit", "nextReview"}
        if not updates:
            raise CommandError("Choose a review interval or next date.")
        interval, unit = payload.get("interval", review.interval), payload.get("unit", review.unit)
        if type(interval) is not int or not 1 <= interval <= 999 or unit not in UNITS:
            raise CommandError("Choose 1–999 days, weeks, months or years.")
        next_day = calendar_day(payload["nextReview"]) if "nextReview" in payload else review.next_review
        if (interval, unit, next_day) == (review.interval, review.unit, review.next_review):
            return result
        review.interval, review.unit, review.next_review = interval, unit, next_day
    review.version += 1
    if review._state.adding:
        review.save(force_insert=True)
    else:
        review.save()
    project.version += 1
    project.changed_at = clock.now
    project.save(update_fields=["version", "changed_at"])
    result.touch(project)
    return result
