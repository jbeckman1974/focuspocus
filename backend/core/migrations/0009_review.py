from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_freeze_legacy_due_clock"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name="ProjectReview",
            fields=[
                ("project", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True,
                                                 serialize=False, to="core.item")),
                ("interval", models.PositiveSmallIntegerField(default=1)),
                ("unit", models.CharField(default="week", max_length=5)),
                ("next_review", models.DateField()),
                ("last_reviewed_at", models.DateTimeField(null=True)),
                ("version", models.PositiveBigIntegerField(default=1)),
                ("last_actor", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                 to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(condition=models.Q(interval__range=(1, 999)), name="review_interval_range"),
                    models.CheckConstraint(condition=models.Q(unit__in=("day", "week", "month", "year")),
                                           name="review_calendar_unit"),
                ],
                "indexes": [models.Index(fields=["workspace", "next_review"], name="workspace_review_queue")],
            },
        ),
        migrations.RunSQL(
            """
            ALTER TABLE core_projectreview ADD CONSTRAINT review_owned_project
            FOREIGN KEY(workspace_id,project_id) REFERENCES core_item(workspace_id,id)
            DEFERRABLE INITIALLY DEFERRED
            """,
            "ALTER TABLE core_projectreview DROP CONSTRAINT review_owned_project",
        ),
        migrations.RunSQL(
            """
            INSERT INTO core_projectreview(project_id,workspace_id,interval,unit,next_review,version)
            SELECT item.id, item.workspace_id, 1, 'week',
                   (coalesce(item.created_at,current_timestamp) AT TIME ZONE workspace.time_zone)::date + 7, 1
              FROM core_item AS item JOIN core_workspace AS workspace ON workspace.id = item.workspace_id
             WHERE item.kind = 'project'
            """,
            migrations.RunSQL.noop,
        ),
    ]
