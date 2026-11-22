from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0019_offline_grants")]
    operations = [
        migrations.AddField(model_name="change", name="removed", field=models.JSONField(default=list)),
    ]
