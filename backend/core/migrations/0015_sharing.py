from uuid import uuid4

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0014_imports"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="SharedWorkspace",
            fields=[
                ("workspace", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                                  primary_key=True, serialize=False, to="core.workspace")),
                ("name", models.CharField(max_length=200)),
                ("version", models.PositiveBigIntegerField(default=0)),
            ],
        ),
        migrations.CreateModel(
            name="WorkspaceInvitation",
            fields=[
                ("id", models.UUIDField(default=uuid4, editable=False, primary_key=True, serialize=False)),
                ("generation", models.UUIDField()),
                ("role", models.CharField(max_length=10)),
                ("digest", models.CharField(max_length=64, unique=True)),
                ("expires_at", models.DateTimeField()),
                ("recipient", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
            options={"constraints": [
                models.UniqueConstraint(fields=["workspace", "recipient"], name="one_invite_per_recipient"),
                models.CheckConstraint(condition=models.Q(role__in=["editor", "viewer"]), name="invitable_roles"),
            ]},
        ),
        migrations.CreateModel(
            name="CaptureCredential",
            fields=[
                ("id", models.UUIDField(default=uuid4, editable=False, primary_key=True, serialize=False)),
                ("generation", models.UUIDField()),
                ("label", models.CharField(max_length=200)),
                ("digest", models.CharField(max_length=64, unique=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
        ),
    ]
