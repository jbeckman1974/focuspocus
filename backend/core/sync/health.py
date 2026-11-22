from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from core.models import Workspace


def schema_ready():
    executor = MigrationExecutor(connection)
    targets = executor.loader.graph.leaf_nodes()
    if executor.migration_plan(targets):
        return False
    # An older application must also decline a newer application schema.
    known = set(executor.loader.disk_migrations)
    if any(app == "core" and (app, name) not in known for app, name in executor.loader.applied_migrations):
        return False
    # Exercise SELECT with the runtime role even with an empty workspace table.
    Workspace.objects.values_list("id", flat=True).first()
    return True
