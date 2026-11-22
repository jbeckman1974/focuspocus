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
CREATE ROLE fpapp LOGIN PASSWORD :'app_password';
CREATE ROLE fpmigrate LOGIN PASSWORD :'migrate_password';
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
