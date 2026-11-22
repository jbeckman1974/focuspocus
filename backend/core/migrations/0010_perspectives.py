from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0009_review"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="PerspectiveState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("version", models.PositiveBigIntegerField(default=0)),
                ("focus_ids", models.JSONField(default=list)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("workspace", "user"),
                                                              name="personal_perspective_state")]},
        ),
        migrations.CreateModel(
            name="SavedPerspective",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("view_id", models.UUIDField()),
                ("name", models.CharField(max_length=200)),
                ("favorite", models.BooleanField(default=False)),
                ("icon", models.CharField(default="list", max_length=16)),
                ("definition", models.JSONField()),
                ("version", models.PositiveBigIntegerField(default=1)),
                ("state", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                            related_name="perspectives", to="core.perspectivestate")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("state", "view_id"),
                                                              name="personal_perspective_id")]},
        ),
    ]
