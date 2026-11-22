"""Shared review schedule and last review of one workspace project."""

from django.conf import settings
from django.db import models


UNITS = ("day", "week", "month", "year")


class ProjectReview(models.Model):
    project = models.OneToOneField("core.Item", primary_key=True, on_delete=models.CASCADE)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    interval = models.PositiveSmallIntegerField(default=1)
    unit = models.CharField(max_length=5, default="week")
    next_review = models.DateField()
    last_reviewed_at = models.DateTimeField(null=True)
    last_actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    version = models.PositiveBigIntegerField(default=1)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(interval__range=(1, 999)), name="review_interval_range"),
            models.CheckConstraint(condition=models.Q(unit__in=UNITS), name="review_calendar_unit"),
        ]
        indexes = [models.Index(fields=["workspace", "next_review"], name="workspace_review_queue")]
