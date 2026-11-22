from django.conf import settings
from django.db import models


class AccountPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, primary_key=True, on_delete=models.CASCADE)
    version = models.PositiveBigIntegerField(default=0)
    values = models.JSONField(default=dict)


class DevicePreference(models.Model):
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    device = models.UUIDField()
    version = models.PositiveBigIntegerField(default=0)
    values = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "user", "device"], name="unique_actor_device_layout")]
