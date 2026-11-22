"""Materialize one independent weekly review schedule when a project is created."""

from core.history.recording import create_many
from core.scheduling.clock import workspace_clock

from .cadence import advance
from .calendar import local_today
from .models import ProjectReview


def weekly_review(workspace, project, start, *, version):
    return ProjectReview(project_id=project.pk, workspace=workspace, interval=1, unit="week",
                         next_review=advance(start, 1, "week"), version=version)


def initialize_projects(workspace, items):
    projects = [item for item in items if item.kind == "project"]
    if projects:
        start = local_today(workspace_clock(workspace))
        create_many(ProjectReview, [weekly_review(workspace, project, start, version=1) for project in projects])
