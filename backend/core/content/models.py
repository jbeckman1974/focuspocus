import uuid

from django.db import models


class ItemNote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    item = models.OneToOneField("core.Item", on_delete=models.CASCADE)
    document = models.JSONField()
    plain_text = models.TextField()


class AttachmentBlob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    size = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    media_type = models.CharField(max_length=100)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "id"], name="attachment_scoped_id"),
            models.UniqueConstraint(fields=["workspace", "sha256"], name="attachment_scoped_hash"),
        ]


class AttachmentBody(models.Model):
    blob = models.OneToOneField(AttachmentBlob, primary_key=True, on_delete=models.CASCADE)
    data = models.BinaryField()


class AttachmentLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    item = models.ForeignKey("core.Item", on_delete=models.CASCADE)
    blob = models.ForeignKey(AttachmentBlob, on_delete=models.PROTECT)
    filename = models.CharField(max_length=200)
