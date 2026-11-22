from django.conf import settings
from django.db import models


class RestoreReceipt(models.Model):
    source = models.ForeignKey("core.Workspace", on_delete=models.CASCADE, related_name="+")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    operation = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    destination = models.ForeignKey("core.Workspace", null=True, on_delete=models.SET_NULL, related_name="+")
    counts = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["source", "actor", "operation"], name="restore_operation_once")]


class RestoredHistory(models.Model):
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    occurred_at = models.DateTimeField()
    action = models.CharField(max_length=80)
    item_ids = models.JSONField(default=list)


class RestoredReviewer(models.Model):
    """Historical source identifier, never an authorization principal in this installation."""
    project = models.OneToOneField("core.Item", on_delete=models.CASCADE, primary_key=True)
    source_label = models.CharField(max_length=40)
    reviewed_at = models.DateTimeField()
