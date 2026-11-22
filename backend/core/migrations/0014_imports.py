import uuid

from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("core", "0013_compact_perspective_receipts")]
    operations = [
        migrations.CreateModel(
            name="ImportBatch",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("source_hash", models.CharField(max_length=64)),
                ("source_format", models.CharField(max_length=12)),
                ("parser_version", models.PositiveIntegerField()),
                ("encoding", models.CharField(max_length=16)),
                ("status", models.CharField(default="staged", max_length=16)),
                ("row_count", models.PositiveIntegerField()),
                ("rows", models.JSONField(default=list)),
                ("issues", models.JSONField(default=list)),
                ("guard", models.JSONField(default=dict)),
                ("conflicts", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
            options={"constraints": [
                models.UniqueConstraint(fields=("workspace", "id"), name="import_batch_scope"),
                models.UniqueConstraint(condition=models.Q(status__in=["staged", "committed"]),
                                        fields=("workspace", "source_format", "source_hash"), name="import_live_file"),
            ]},
        ),
        migrations.CreateModel(
            name="ImportMapping",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_key", models.CharField(max_length=80)),
                ("source_id", models.CharField(blank=True, max_length=500)),
                ("line", models.PositiveIntegerField()),
                ("item_id", models.UUIDField()),
                ("active", models.BooleanField(default=True)),
                ("batch", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                            related_name="mappings", to="core.importbatch")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
            options={"constraints": [
                models.UniqueConstraint(condition=models.Q(active=True), fields=("workspace", "source_key"),
                                        name="import_live_identity"),
                models.UniqueConstraint(fields=("batch", "source_key"), name="import_batch_source"),
            ]},
        ),
        migrations.RunSQL(
            "ALTER TABLE core_importmapping ADD CONSTRAINT import_mapping_scope FOREIGN KEY(workspace_id,batch_id) "
            "REFERENCES core_importbatch(workspace_id,id) DEFERRABLE INITIALLY DEFERRED",
            "ALTER TABLE core_importmapping DROP CONSTRAINT import_mapping_scope",
        ),
    ]
