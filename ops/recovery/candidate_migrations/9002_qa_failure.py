from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "9001_qa_marker")]
    operations = [
        migrations.RunSQL("ALTER TABLE qa_migration_marker ADD COLUMN uncommitted integer"),
        migrations.RunSQL("INSERT INTO qa_migration_marker (step) VALUES (2)"),
        migrations.RunSQL("DO $$ BEGIN RAISE EXCEPTION 'intentional QA migration failure'; END $$"),
    ]
