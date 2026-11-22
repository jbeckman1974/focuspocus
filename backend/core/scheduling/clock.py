"""Bind one evaluation to a workspace and an optional browser presentation zone."""

from django.utils import timezone

from .dates import DateContext


def workspace_clock(workspace, now=None, *, view_zone=None):
    zone = workspace.time_zone if view_zone is None else view_zone
    return DateContext(zone, now if now is not None else timezone.now(), workspace.date_defaults)
