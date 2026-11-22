from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0016_adapters"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="RestoreReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("operation", models.UUIDField()),
                ("fingerprint", models.CharField(max_length=64)),
                ("counts", models.JSONField()),
                ("actor", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ("source", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to="core.workspace")),
                ("destination", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="core.workspace")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("source", "actor", "operation"), name="restore_operation_once")]},
        ),
        migrations.CreateModel(
            name="RestoredReviewer",
            fields=[
                ("project", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, serialize=False, to="core.item")),
                ("source_label", models.CharField(max_length=40)),
                ("reviewed_at", models.DateTimeField()),
            ],
        ),
        migrations.CreateModel(
            name="RestoredHistory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("occurred_at", models.DateTimeField()),
                ("action", models.CharField(max_length=80)),
                ("item_ids", models.JSONField(default=list)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
        ),
    ]
