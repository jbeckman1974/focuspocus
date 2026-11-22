from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0021_membership_incarnations")]
    operations = [
        migrations.RunSQL("CREATE TABLE qa_migration_marker (step integer PRIMARY KEY)"),
        migrations.RunSQL("INSERT INTO qa_migration_marker VALUES (1)"),
    ]
