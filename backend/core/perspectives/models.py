from django.conf import settings
from django.db import models


class PerspectiveState(models.Model):
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    version = models.PositiveBigIntegerField(default=0)
    focus_ids = models.JSONField(default=list)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "user"], name="personal_perspective_state")]


class SavedPerspective(models.Model):
    state = models.ForeignKey(PerspectiveState, on_delete=models.CASCADE, related_name="perspectives")
    view_id = models.UUIDField()
    name = models.CharField(max_length=200)
    favorite = models.BooleanField(default=False)
    icon = models.CharField(max_length=16, default="list")
    definition = models.JSONField()
    version = models.PositiveBigIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["state", "view_id"], name="personal_perspective_id")]
