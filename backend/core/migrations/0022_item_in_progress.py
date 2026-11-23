from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0021_membership_incarnations")]

    operations = [
        migrations.AddField(
            model_name="item",
            name="in_progress",
            field=models.BooleanField(default=False, db_default=False),
        ),
        migrations.AddConstraint(
            model_name="item",
            constraint=models.CheckConstraint(
                condition=models.Q(in_progress=False) | models.Q(kind__in=("action", "group")),
                name="item_progress_task",
            ),
        ),
    ]
