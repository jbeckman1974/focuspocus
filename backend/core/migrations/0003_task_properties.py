"""Record task properties while preserving the M2 completion bit and identities."""

from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    dependencies = [("core", "0002_scoped_relationships")]
    operations = [
        migrations.RemoveConstraint("item", "item_kind"),
        migrations.AddField("item", "disposition", models.CharField(default="active", max_length=12)),
        migrations.AddField("item", "mode", models.CharField(blank=True, null=True, max_length=16)),
        migrations.AddField("item", "auto_complete", models.BooleanField(default=False)),
        migrations.AddField("item", "flagged", models.BooleanField(default=False)),
        migrations.AddField("item", "created_at", models.DateTimeField(null=True)),
        migrations.AddField("item", "changed_at", models.DateTimeField(null=True)),
        migrations.AddField("item", "completed_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("item", "dropped_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("tag", "status", models.CharField(default="active", max_length=12)),
        # M2 recorded change times but did not record creation and completion dates.
        migrations.RunSQL(
            """
            UPDATE core_item AS item SET changed_at = observed.last_change
              FROM (
                  SELECT workspace_id, touched.id, max(created_at) AS last_change
                    FROM core_change
                    CROSS JOIN LATERAL jsonb_array_elements_text(affected) AS touched(id)
                   GROUP BY workspace_id, touched.id
              ) AS observed
             WHERE item.workspace_id = observed.workspace_id AND item.id::text = observed.id
            """,
            migrations.RunSQL.noop,
        ),
        migrations.AlterField("item", "created_at", models.DateTimeField(null=True, default=timezone.now)),
        migrations.AlterField("item", "changed_at", models.DateTimeField(null=True, default=timezone.now)),
        migrations.AddConstraint("tag", models.CheckConstraint(
            condition=models.Q(status__in=["active", "held", "dropped"]), name="tag_status",
        )),
        migrations.AddConstraint("item", models.CheckConstraint(condition=models.Q(kind__in=["folder", "project", "group", "action"]), name="item_kind")),
        migrations.AddConstraint("item", models.CheckConstraint(
            condition=(models.Q(disposition="active") | models.Q(disposition="dropped", done=False)
                       | models.Q(disposition="held", done=False, kind="project")),
            name="item_disposition",
        )),
        migrations.AddConstraint("item", models.CheckConstraint(
            condition=(models.Q(mode__isnull=True)
                       | models.Q(mode__in=["parallel", "sequential"], kind__in=["project", "group"])
                       | models.Q(kind="project", mode="single-action")),
            name="item_container_mode",
        )),
        migrations.AddConstraint("item", models.CheckConstraint(
            condition=(models.Q(auto_complete=False)
                       | (models.Q(kind__in=["project", "group"]) & ~models.Q(mode="single-action"))),
            name="item_auto_complete",
        )),
        migrations.AddConstraint("item", models.CheckConstraint(condition=~models.Q(kind="folder", done=True), name="folder_completion")),
    ]
