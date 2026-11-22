"""Discard duplicate personal catalogs while preserving the original operation acknowledgements."""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0012_preferences")]
    operations = [
        migrations.RunSQL(
            """
            UPDATE core_receipt
               SET result = result - 'focusIds' - 'perspectives'
             WHERE jsonb_typeof(result->'personalVersion') = 'number'
               AND jsonb_typeof(result->'focusIds') = 'array'
               AND jsonb_typeof(result->'perspectives') = 'array'
               AND inverse = '{}'::jsonb
            """,
            migrations.RunSQL.noop,
        ),
    ]
