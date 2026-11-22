#!/bin/sh
set -eu
FP_APP_PASSWORD=$(cat /run/secrets/database-app)
FP_MIGRATE_PASSWORD=$(cat /run/secrets/database-migrate)
export FP_APP_PASSWORD FP_MIGRATE_PASSWORD
psql -X --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv db POSTGRES_DB
\getenv app_password FP_APP_PASSWORD
\getenv migrate_password FP_MIGRATE_PASSWORD
BEGIN;
SELECT format('CREATE ROLE fpapp LOGIN PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fpapp') \gexec
SELECT format('CREATE ROLE fpmigrate LOGIN PASSWORD %L', :'migrate_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fpmigrate') \gexec
DO $roles$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('fpapp','fpmigrate')
               AND (rolsuper OR rolcreaterole OR rolbypassrls OR rolreplication OR NOT rolcanlogin))
       OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fpapp' AND rolcreatedb)
    THEN RAISE EXCEPTION 'Unexpected pre-existing database role attributes';
    END IF;
END
$roles$;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO fpapp, fpmigrate;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO fpmigrate;
GRANT USAGE ON SCHEMA public TO fpapp;
COMMIT;
SQL
if [ "${FOCUSPOCUS_TEST_CLUSTER:-}" = "1" ]; then
    psql -X --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
        -c 'ALTER ROLE fpmigrate CREATEDB'
fi
