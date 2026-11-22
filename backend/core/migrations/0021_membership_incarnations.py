import uuid

from django.db import migrations, models


# An independent random stamp distinguishes two histories even if a restored
# database assigns the same PK and has observed the same number of role changes.
STAMP_MEMBERSHIP = """
CREATE OR REPLACE FUNCTION fp_stamp_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.incarnation := OLD.incarnation;
    IF (NEW.role, NEW.workspace_id, NEW.user_id)
       IS DISTINCT FROM (OLD.role, OLD.workspace_id, OLD.user_id) THEN
        NEW.incarnation := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;
"""
STAMP_EPOCH = """
CREATE OR REPLACE FUNCTION fp_stamp_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.role_epoch := OLD.role_epoch;
    IF (NEW.role, NEW.workspace_id, NEW.user_id)
       IS DISTINCT FROM (OLD.role, OLD.workspace_id, OLD.user_id) THEN
        NEW.role_epoch := OLD.role_epoch + 1;
    END IF;
    RETURN NEW;
END;
$$;
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0020_change_tombstones")]
    operations = [
        migrations.AddField(model_name="membership", name="incarnation", field=models.UUIDField(null=True)),
        migrations.RunSQL("UPDATE core_membership SET incarnation = gen_random_uuid(); SET CONSTRAINTS ALL IMMEDIATE;",
                          migrations.RunSQL.noop),
        migrations.AlterField(model_name="membership", name="incarnation",
                              field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
        migrations.RunSQL(STAMP_MEMBERSHIP, STAMP_EPOCH),
        migrations.RemoveField(model_name="membership", name="role_epoch"),
    ]
