import os

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", os.environ["FOCUSPOCUS_QA_BASE_MIGRATION"])]
    operations = [
        migrations.RunSQL("CREATE TABLE qa_migration_marker (step integer PRIMARY KEY)"),
        migrations.RunSQL("INSERT INTO qa_migration_marker VALUES (1)"),
    ]
