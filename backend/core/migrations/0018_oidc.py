from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0017_portability"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="IdentityBinding",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("issuer", models.URLField(max_length=512)),
                ("subject", models.CharField(max_length=255)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={"constraints": [models.UniqueConstraint(fields=["issuer", "subject"], name="oidc_unique_identity")]},
        ),
        migrations.CreateModel(
            name="LoginChallenge",
            fields=[
                ("state_digest", models.CharField(max_length=64, primary_key=True, serialize=False)),
                ("browser_digest", models.CharField(max_length=64)),
                ("policy_digest", models.CharField(max_length=64)),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("nonce", models.CharField(max_length=90)),
                ("verifier", models.CharField(max_length=90)),
            ],
        ),
    ]
