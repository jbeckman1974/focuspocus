from uuid import uuid4

from django.conf import settings
from django.db import models


class SharedWorkspace(models.Model):
    workspace = models.OneToOneField("core.Workspace", primary_key=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    version = models.PositiveBigIntegerField(default=0)


class WorkspaceInvitation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    generation = models.UUIDField()
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=10)
    digest = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "recipient"], name="one_invite_per_recipient"),
            models.CheckConstraint(condition=models.Q(role__in=["editor", "viewer"]), name="invitable_roles"),
        ]


class CaptureCredential(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    generation = models.UUIDField()
    label = models.CharField(max_length=200)
    digest = models.CharField(max_length=64, unique=True)
