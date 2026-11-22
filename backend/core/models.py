import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .lifecycle_models import ItemLifecycleFields, TagTreeFields, WorkspaceFilingFields


class Workspace(WorkspaceFilingFields):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    revision = models.PositiveBigIntegerField(default=0)
    generation = models.UUIDField(default=uuid.uuid4, editable=False)
    time_zone = models.CharField(max_length=128, default="UTC")
    date_defaults = models.JSONField(default=dict)
    private_owner = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.CASCADE,
        related_name="private_workspace",
    )


class Membership(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=12)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "user"], name="member_once"),
            models.CheckConstraint(condition=models.Q(role__in=["owner", "editor", "viewer"]), name="member_role"),
        ]


class Tag(TagTreeFields):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    title = models.CharField(max_length=255)
    status = models.CharField(max_length=12, default="active")
    version = models.PositiveBigIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "id"], name="tag_scoped_id"),
            models.CheckConstraint(condition=models.Q(status__in=["active", "held", "dropped"]), name="tag_status"),
        ]


class Item(ItemLifecycleFields):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    parent = models.ForeignKey("self", null=True, blank=True, related_name="children", on_delete=models.CASCADE)
    kind = models.CharField(max_length=12)
    title = models.CharField(max_length=255)
    position = models.BigIntegerField()
    done = models.BooleanField(default=False)
    disposition = models.CharField(max_length=12, default="active")
    mode = models.CharField(max_length=16, null=True, blank=True)
    auto_complete = models.BooleanField(default=False)
    flagged = models.BooleanField(default=False)
    created_at = models.DateTimeField(null=True, default=timezone.now)
    changed_at = models.DateTimeField(null=True, default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)
    dropped_at = models.DateTimeField(null=True, blank=True)
    tags = models.ManyToManyField(Tag, through="ItemTag")
    due = models.DateField(null=True, blank=True)
    schedule = models.JSONField(default=dict)
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    version = models.PositiveBigIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "id"], name="item_scoped_id"),
            models.CheckConstraint(condition=models.Q(kind__in=["folder", "project", "group", "action"]), name="item_kind"),
            models.CheckConstraint(
                condition=(models.Q(disposition="active") | models.Q(disposition="dropped", done=False)
                           | models.Q(disposition="held", done=False, kind="project")),
                name="item_disposition",
            ),
            models.CheckConstraint(
                condition=(models.Q(mode__isnull=True)
                           | models.Q(mode__in=["parallel", "sequential"], kind__in=["project", "group"])
                           | models.Q(kind="project", mode="single-action")),
                name="item_container_mode",
            ),
            models.CheckConstraint(
                condition=(models.Q(auto_complete=False)
                           | (models.Q(kind__in=["project", "group"]) & ~models.Q(mode="single-action"))),
                name="item_auto_complete",
            ),
            models.CheckConstraint(condition=~models.Q(kind="folder", done=True), name="folder_completion"),
            models.CheckConstraint(
                condition=models.Q(duration_minutes__isnull=True) | models.Q(duration_minutes__lte=5_259_600),
                name="item_duration_range",
            ),
        ]
        indexes = [models.Index(fields=["workspace", "parent", "position"], name="item_sibling_order")]

    @property
    def status(self):
        return "completed" if self.done else self.disposition


class ItemTag(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    item = models.ForeignKey(Item, on_delete=models.CASCADE)
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["item", "tag"], name="item_tag_once")]


class Receipt(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    context_id = models.UUIDField()
    operation_id = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    result = models.JSONField()
    inverse = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "actor", "context_id", "operation_id"], name="operation_once"),
        ]


class Change(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    revision = models.PositiveBigIntegerField()
    affected = models.JSONField(default=list)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "revision"], name="change_once"),
        ]


class Job(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    kind = models.CharField(max_length=64)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=12, default="pending")
    dedupe_key = models.CharField(max_length=200)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    lease_token = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    last_error = models.CharField(max_length=64, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "dedupe_key"], name="job_once"),
        ]
        indexes = [models.Index(fields=["status", "next_attempt_at"], name="job_available")]


class WorkerHeartbeat(models.Model):
    name = models.CharField(max_length=255, unique=True)
    updated_at = models.DateTimeField(default=timezone.now)


class PasswordRecovery(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    digest = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()


class LoginWindow(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    started_at = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)


# Django discovers the recurrence models along with the core application's tables.
from .repeats.models import Occurrence, RepeatSeries  # noqa: E402, F401
