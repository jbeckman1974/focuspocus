from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0006_repeating_occurrences"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="OrganizationPreference",
            fields=[
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                              primary_key=True, serialize=False, to=settings.AUTH_USER_MODEL)),
                ("resolved_cleanup", models.CharField(default="on-cleanup", max_length=12)),
            ],
            options={"constraints": [
                models.CheckConstraint(condition=models.Q(resolved_cleanup__in=["immediate", "on-cleanup"]),
                                       name="cleanup_mode")
            ]},
        ),
    ]
