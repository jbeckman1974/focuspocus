"""Freeze the workspace's current due clock on calendar dates upgraded from M2."""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0007_organization_preference")]
    operations = [
        migrations.RunSQL(
            """
            UPDATE core_item AS item
               SET schedule = jsonb_set(
                   item.schedule, '{due,defaultTime}',
                   to_jsonb(coalesce(workspace.date_defaults->>'due', '17:00')))
              FROM core_workspace AS workspace
             WHERE item.workspace_id = workspace.id
               AND item.due IS NOT NULL
               AND item.schedule->'due'->>'kind' = 'date'
               AND item.schedule->'due'->>'value' = to_char(item.due, 'YYYY-MM-DD')
               AND NOT (item.schedule->'due' ? 'defaultTime')
            """,
            # Older readers already accept a stored defaultTime. Preserve the interpretation.
            migrations.RunSQL.noop,
        ),
    ]
