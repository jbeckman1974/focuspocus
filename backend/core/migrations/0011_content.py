import uuid

from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


def identity():
    return models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)


def workspace():
    return models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")


class Migration(migrations.Migration):
    dependencies = [("core", "0010_perspectives")]
    operations = [
        migrations.CreateModel(
            name="ItemNote",
            fields=[
                ("id", identity()), ("document", models.JSONField()), ("plain_text", models.TextField()),
                ("item", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to="core.item")),
                ("workspace", workspace()),
            ],
        ),
        migrations.CreateModel(
            name="AttachmentBlob",
            fields=[
                ("id", identity()), ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("size", models.PositiveBigIntegerField()),
                ("sha256", models.CharField(max_length=64)), ("media_type", models.CharField(max_length=100)),
                ("workspace", workspace()),
            ],
            options={"constraints": [
                models.UniqueConstraint(fields=("workspace", "id"), name="attachment_scoped_id"),
                models.UniqueConstraint(fields=("workspace", "sha256"), name="attachment_scoped_hash"),
            ]},
        ),
        migrations.CreateModel(
            name="AttachmentBody",
            fields=[
                ("blob", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True,
                                              serialize=False, to="core.attachmentblob")),
                ("data", models.BinaryField()),
            ],
        ),
        migrations.CreateModel(
            name="AttachmentLink",
            fields=[
                ("id", identity()), ("filename", models.CharField(max_length=200)),
                ("blob", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="core.attachmentblob")),
                ("item", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.item")),
                ("workspace", workspace()),
            ],
        ),
        migrations.RunSQL(
            """
            ALTER TABLE core_itemnote ADD CONSTRAINT note_owned_item FOREIGN KEY(workspace_id,item_id)
                REFERENCES core_item(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_attachmentlink ADD CONSTRAINT file_owned_item FOREIGN KEY(workspace_id,item_id)
                REFERENCES core_item(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_attachmentlink ADD CONSTRAINT file_owned_body FOREIGN KEY(workspace_id,blob_id)
                REFERENCES core_attachmentblob(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
            """,
            """
            ALTER TABLE core_itemnote DROP CONSTRAINT note_owned_item;
            ALTER TABLE core_attachmentlink DROP CONSTRAINT file_owned_item;
            ALTER TABLE core_attachmentlink DROP CONSTRAINT file_owned_body;
            """,
        ),
    ]
