"""Check the deployed runtime role; hash ordered synthetic content for recovery comparison."""

import hashlib
import json

import django
from django.db import connection

django.setup()
from core.models import Item, ItemTag, Tag, Workspace


def check_grants():
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT current_user = 'fpapp', NOT rolsuper, NOT rolcreaterole,
                   NOT rolcreatedb, NOT rolbypassrls, NOT rolreplication,
                   NOT has_schema_privilege(current_user, 'public', 'CREATE'),
                   NOT has_database_privilege(current_user, current_database(), 'CREATE'),
                   NOT has_database_privilege(current_user, current_database(), 'TEMP'),
                   NOT has_table_privilege(current_user, 'django_migrations', 'UPDATE'),
                   has_table_privilege(current_user, 'core_item', 'UPDATE')
              FROM pg_roles WHERE rolname = current_user
        """)
        privileges = cursor.fetchone()
        if not privileges or not all(privileges):
            raise RuntimeError("The runtime role grants differ from the deployment contract")


def content_digest():
    if Workspace.objects.count() < 2 or not Item.objects.exists():
        raise RuntimeError("Browser fixtures did not leave two private workspaces and a saved item")
    digest = hashlib.sha256()
    for model in (Workspace, Item, Tag, ItemTag):
        for row in model.objects.order_by("pk").values().iterator():
            if model is Workspace:
                row.pop("generation")  # A restored workspace deliberately receives a new generation.
            digest.update(json.dumps(row, sort_keys=True, default=str).encode("utf-8"))
            digest.update(b"\n")
    return digest.hexdigest()


check_grants()
print(content_digest())
