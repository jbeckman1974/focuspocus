import uuid

from django.db import models
from django.utils import timezone


class ImportBatch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    source_hash = models.CharField(max_length=64)
    source_format = models.CharField(max_length=12)
    parser_version = models.PositiveIntegerField()
    encoding = models.CharField(max_length=16)
    status = models.CharField(max_length=16, default="staged")
    row_count = models.PositiveIntegerField()
    rows = models.JSONField(default=list)
    issues = models.JSONField(default=list)
    guard = models.JSONField(default=dict)
    conflicts = models.JSONField(default=list)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "id"], name="import_batch_scope"),
            models.UniqueConstraint(fields=["workspace", "source_format", "source_hash"],
                                    condition=models.Q(status__in=["staged", "committed"]), name="import_live_file"),
        ]


class ImportMapping(models.Model):
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="mappings")
    source_key = models.CharField(max_length=80)
    source_id = models.CharField(max_length=500, blank=True)
    line = models.PositiveIntegerField()
    # A durable identity survives deletion so an old export cannot revive lost items.
    item_id = models.UUIDField()
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "source_key"], condition=models.Q(active=True),
                                    name="import_live_identity"),
            models.UniqueConstraint(fields=["batch", "source_key"], name="import_batch_source"),
        ]
