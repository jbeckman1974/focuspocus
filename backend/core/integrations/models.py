from django.conf import settings
from django.db import models


class CalendarConnection(models.Model):
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    source = models.CharField(max_length=80)
    last_success = models.DateTimeField(null=True)
    status = models.CharField(max_length=40, default="queued")

    class Meta:
        constraints = [models.UniqueConstraint(fields=("workspace", "user", "source"), name="calendar_subscription")]


class CalendarEvent(models.Model):
    connection = models.ForeignKey(CalendarConnection, on_delete=models.CASCADE)
    key = models.CharField(max_length=64)
    title = models.CharField(max_length=512)
    start = models.CharField(max_length=40)
    end = models.CharField(max_length=40)
    all_day = models.BooleanField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=("connection", "key"), name="calendar_event_identity")]


class Reminder(models.Model):
    # Public id is unique within its owner's workspace, so UUID reuse cannot reveal another user's row.
    public_id = models.UUIDField()
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    item = models.ForeignKey("core.Item", on_delete=models.CASCADE)
    at = models.DateTimeField()
    status = models.CharField(max_length=16, default="scheduled")

    class Meta:
        constraints = [models.UniqueConstraint(fields=("workspace", "user", "public_id"), name="personal_reminder_id")]


class PushDevice(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    device = models.UUIDField()
    endpoint = models.TextField()
    endpoint_digest = models.CharField(max_length=64, unique=True, null=True)
    enabled = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("user", "device"), name="personal_push_device")]


class ReminderDelivery(models.Model):
    reminder = models.ForeignKey(Reminder, on_delete=models.CASCADE)
    device = models.ForeignKey(PushDevice, on_delete=models.CASCADE)
    status = models.CharField(max_length=24, default="pending")

    class Meta:
        constraints = [models.UniqueConstraint(fields=("reminder", "device"), name="one_reminder_delivery")]


class TagPlace(models.Model):
    tag = models.OneToOneField("core.Tag", primary_key=True, on_delete=models.CASCADE)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_meters = models.PositiveIntegerField()
