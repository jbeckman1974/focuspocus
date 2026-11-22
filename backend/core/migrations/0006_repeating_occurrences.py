import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0005_schedule_fields")]
    operations = [
        migrations.CreateModel(
            name="RepeatSeries",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("rule", models.JSONField()), ("origin", models.JSONField()),
                ("remaining", models.PositiveIntegerField(null=True)),
                ("version", models.PositiveBigIntegerField(default=1)), ("active", models.BooleanField(default=True)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("workspace", "id"), name="series_scoped_id")]},
        ),
        migrations.CreateModel(
            name="Occurrence",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("outcome", models.CharField(default="open", max_length=12)),
                ("resolved_at", models.DateTimeField(null=True)), ("applied_rule", models.JSONField(null=True)),
                ("item", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to="core.item")),
                ("predecessor", models.OneToOneField(null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                      related_name="successor", to="core.occurrence")),
                ("series", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.repeatseries")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.workspace")),
            ],
            options={"constraints": [
                models.UniqueConstraint(fields=("workspace", "series", "id"), name="occurrence_scoped_series"),
                models.CheckConstraint(condition=models.Q(outcome__in=("open", "completed", "dropped", "skipped")),
                                       name="occurrence_outcome"),
            ]},
        ),
        migrations.RunSQL(
            """
            ALTER TABLE core_occurrence ADD CONSTRAINT occurrence_owned_item FOREIGN KEY(workspace_id,item_id)
                REFERENCES core_item(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_occurrence ADD CONSTRAINT occurrence_owned_series FOREIGN KEY(workspace_id,series_id)
                REFERENCES core_repeatseries(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_occurrence ADD CONSTRAINT occurrence_same_chain
                FOREIGN KEY(workspace_id,series_id,predecessor_id) REFERENCES core_occurrence(workspace_id,series_id,id)
                DEFERRABLE INITIALLY DEFERRED;
            """,
            """
            ALTER TABLE core_occurrence DROP CONSTRAINT occurrence_same_chain;
            ALTER TABLE core_occurrence DROP CONSTRAINT occurrence_owned_series;
            ALTER TABLE core_occurrence DROP CONSTRAINT occurrence_owned_item;
            """,
        ),
    ]
