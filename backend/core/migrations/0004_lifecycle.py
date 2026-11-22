from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0003_task_properties")]

    operations = [
        migrations.AddField("workspace", "filing_policy", models.CharField(default="project", max_length=8)),
        migrations.AddField("tag", "exclusive", models.BooleanField(default=False)),
        migrations.AddField("tag", "parent", models.ForeignKey(blank=True, null=True,
            on_delete=django.db.models.deletion.PROTECT, related_name="child_tags", to="core.tag")),
        migrations.AddField("item", "shelf", models.CharField(default="active", max_length=8)),
        migrations.AddField("item", "shelf_root", models.UUIDField(blank=True, null=True)),
        migrations.AddField("item", "shelf_before", models.UUIDField(blank=True, null=True)),
        migrations.AddField("item", "filing_project", models.ForeignKey(blank=True, null=True,
            on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="core.item")),
        migrations.AddField("item", "is_miscellaneous", models.BooleanField(default=False)),
        migrations.RunSQL(
            """
            ALTER TABLE core_tag ADD CONSTRAINT tag_parent_same_workspace
                FOREIGN KEY (workspace_id, parent_id) REFERENCES core_tag (workspace_id, id)
                DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_item ADD CONSTRAINT filing_project_same_workspace
                FOREIGN KEY (workspace_id, filing_project_id) REFERENCES core_item (workspace_id, id)
                DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_item ADD CONSTRAINT item_shelf_shape CHECK
                ((shelf = 'active' AND shelf_root IS NULL AND shelf_before IS NULL)
                  OR (shelf IN ('trash', 'archive') AND shelf_root IS NOT NULL));
            CREATE UNIQUE INDEX workspace_active_misc ON core_item(workspace_id)
                WHERE is_miscellaneous AND shelf = 'active';
            ALTER TABLE core_workspace ADD CONSTRAINT workspace_filing_policy CHECK
                (filing_policy IN ('either','both','tag','project'));
            """,
            """
            ALTER TABLE core_workspace DROP CONSTRAINT workspace_filing_policy;
            DROP INDEX workspace_active_misc;
            ALTER TABLE core_item DROP CONSTRAINT item_shelf_shape;
            ALTER TABLE core_item DROP CONSTRAINT filing_project_same_workspace;
            ALTER TABLE core_tag DROP CONSTRAINT tag_parent_same_workspace;
            """,
        ),
    ]
