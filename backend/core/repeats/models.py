import uuid

from django.db import models


OUTCOMES = ("open", "completed", "dropped", "skipped")


class RepeatSeries(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    rule = models.JSONField()
    origin = models.JSONField()
    remaining = models.PositiveIntegerField(null=True)
    version = models.PositiveBigIntegerField(default=1)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "id"], name="series_scoped_id"),
        ]


class Occurrence(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    item = models.OneToOneField("core.Item", on_delete=models.CASCADE)
    series = models.ForeignKey(RepeatSeries, on_delete=models.CASCADE)
    predecessor = models.OneToOneField("self", null=True, on_delete=models.SET_NULL, related_name="successor")
    outcome = models.CharField(max_length=12, default="open")
    resolved_at = models.DateTimeField(null=True)
    applied_rule = models.JSONField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "series", "id"], name="occurrence_scoped_series"),
            models.CheckConstraint(condition=models.Q(outcome__in=OUTCOMES), name="occurrence_outcome"),
        ]
