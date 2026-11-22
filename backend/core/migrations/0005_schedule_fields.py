"""Preserve each M2 due date as a direct calendar day, with no assumed clock."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0004_lifecycle")]
    operations = [
        migrations.AddField("workspace", "time_zone", models.CharField(default="UTC", max_length=128)),
        migrations.AddField("workspace", "date_defaults", models.JSONField(default=dict)),
        migrations.AddField("item", "schedule", models.JSONField(default=dict)),
        migrations.AddField("item", "duration_minutes", models.PositiveIntegerField(null=True, blank=True)),
        migrations.RunSQL(
            """
            UPDATE core_item
               SET schedule = jsonb_build_object('due', jsonb_build_object(
                   'kind', 'date', 'value', to_char(due, 'YYYY-MM-DD')))
             WHERE due IS NOT NULL;
            ALTER TABLE core_item ADD CONSTRAINT item_schedule_object CHECK (
                jsonb_typeof(schedule) = 'object'
                AND (schedule - ARRAY['defer','planned','due']) = '{}'::jsonb
                AND (NOT schedule ? 'defer' OR jsonb_typeof(schedule->'defer') = 'object')
                AND (NOT schedule ? 'planned' OR jsonb_typeof(schedule->'planned') = 'object')
                AND (NOT schedule ? 'due' OR jsonb_typeof(schedule->'due') = 'object')
            );
            ALTER TABLE core_workspace ADD CONSTRAINT workspace_date_defaults_object CHECK (
                jsonb_typeof(date_defaults) = 'object'
                AND (date_defaults - ARRAY['defer','planned','due']) = '{}'::jsonb
            );
            """,
            """
            ALTER TABLE core_workspace DROP CONSTRAINT workspace_date_defaults_object;
            ALTER TABLE core_item DROP CONSTRAINT item_schedule_object;
            """,
        ),
        migrations.AddConstraint("item", models.CheckConstraint(
            condition=models.Q(duration_minutes__isnull=True) | models.Q(duration_minutes__lte=5_259_600),
            name="item_duration_range",
        )),
    ]
