from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0011_content"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="AccountPreference",
            fields=[
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True,
                                              serialize=False, to=settings.AUTH_USER_MODEL)),
                ("version", models.PositiveBigIntegerField(default=0)),
                ("values", models.JSONField(default=dict)),
            ],
        ),
        migrations.CreateModel(
            name="DevicePreference",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("device", models.UUIDField()),
                ("version", models.PositiveBigIntegerField(default=0)),
                ("values", models.JSONField(default=dict)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={"constraints": [
                models.UniqueConstraint(fields=("workspace", "user", "device"), name="unique_actor_device_layout"),
            ]},
        ),
    ]
