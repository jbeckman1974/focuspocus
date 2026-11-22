import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0018_oidc")]
    operations = [
        migrations.AddField(
            model_name="membership", name="role_epoch",
            field=models.PositiveBigIntegerField(default=1, editable=False),
        ),
        migrations.RunSQL(
            """
            CREATE FUNCTION fp_stamp_membership() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                NEW.role_epoch := OLD.role_epoch;
                IF (NEW.role, NEW.workspace_id, NEW.user_id)
                   IS DISTINCT FROM (OLD.role, OLD.workspace_id, OLD.user_id) THEN
                    NEW.role_epoch := OLD.role_epoch + 1;
                END IF;
                RETURN NEW;
            END;
            $$;
            CREATE TRIGGER fp_membership_epoch BEFORE UPDATE ON core_membership
            FOR EACH ROW EXECUTE FUNCTION fp_stamp_membership();
            """,
            "DROP TRIGGER fp_membership_epoch ON core_membership; DROP FUNCTION fp_stamp_membership();",
        ),
        migrations.AddIndex(model_name="receipt",
                            index=models.Index(fields=["created_at", "id"], name="receipt_expiry_order")),
        migrations.AddIndex(model_name="change",
                            index=models.Index(fields=["created_at", "id"], name="change_expiry_order")),
        migrations.CreateModel(
            name="CaptureAcknowledgement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("operation_id", models.UUIDField()),
                ("item_id", models.UUIDField()),
                ("fingerprint", models.CharField(max_length=64)),
                ("credential", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                                  to="core.capturecredential")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=["credential", "operation_id"],
                                                            name="capture_ack_once")]},
        ),
    ]
