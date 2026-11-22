from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [
        migrations.RunSQL(
            """
            ALTER TABLE core_item ADD CONSTRAINT item_parent_same_workspace
                FOREIGN KEY (workspace_id, parent_id) REFERENCES core_item (workspace_id, id)
                DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_itemtag ADD CONSTRAINT link_item_same_workspace
                FOREIGN KEY (workspace_id, item_id) REFERENCES core_item (workspace_id, id)
                DEFERRABLE INITIALLY DEFERRED;
            ALTER TABLE core_itemtag ADD CONSTRAINT link_tag_same_workspace
                FOREIGN KEY (workspace_id, tag_id) REFERENCES core_tag (workspace_id, id)
                DEFERRABLE INITIALLY DEFERRED;
            """,
            """
            ALTER TABLE core_itemtag DROP CONSTRAINT link_tag_same_workspace;
            ALTER TABLE core_itemtag DROP CONSTRAINT link_item_same_workspace;
            ALTER TABLE core_item DROP CONSTRAINT item_parent_same_workspace;
            """,
        ),
    ]
