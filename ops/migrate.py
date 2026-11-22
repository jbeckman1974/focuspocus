"""Serialize migrations and grant only the application privileges needed by this schema."""

import sys
from pathlib import Path

import django
from django.core.management import call_command
from django.db import connection
from psycopg import sql

sys.path.insert(0, str(Path("/srv/app")))
django.setup()


def migrate() -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_lock(hashtext('focuspocus-schema'))")
        try:
            call_command("migrate", interactive=False)
            cursor.execute(
                "SELECT relname FROM pg_class JOIN pg_namespace n ON n.oid = relnamespace "
                "WHERE n.nspname = 'public' AND relkind = 'r'"
            )
            for (table,) in cursor.fetchall():
                if table.startswith("core_") or table in {"auth_user", "django_session"}:
                    grants = "SELECT, INSERT, UPDATE, DELETE"
                elif table.startswith("auth_") or table in {"django_migrations", "django_content_type"}:
                    grants = "SELECT"
                else:
                    continue
                cursor.execute(sql.SQL("GRANT {} ON TABLE public.{} TO fpapp").format(
                    sql.SQL(grants), sql.Identifier(table)
                ))
            cursor.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fpapp")
        finally:
            cursor.execute("SELECT pg_advisory_unlock(hashtext('focuspocus-schema'))")


if __name__ == "__main__":
    migrate()
