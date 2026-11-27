#!/usr/bin/env bash
# Called only within the isolated project's lifetime. The old cluster stays recoverable.
set -euo pipefail
set +x
umask 077
: "${FOCUSPOCUS_QA_SCRATCH:?Run ops/pg-upgrade/verify.sh}"
[[ $COMPOSE_PROJECT_NAME =~ ^focuspocus-qa-stack-[a-f0-9]{32}$ && $APP_ENV == development ]]
compose=(docker compose -f compose.yaml -f ops/compose.tests.yaml -f ops/pg-upgrade/compose.yaml --profile testing)
if [[ -n ${FOCUSPOCUS_TEST_DATA_DIR:-} ]]; then compose+=(-f ops/compose.host-test.yaml); fi
dc() { "${compose[@]}" "$@"; }
sql() { dc exec -T "$1" psql -XAt -v ON_ERROR_STOP=1 -U postgres -d focuspocus -c "$2"; }
digest() { dc run -T --rm --no-deps web python - fingerprint < ops/pg-upgrade/fixture.py; }
generations() { sql "$1" 'SELECT generation FROM core_workspace ORDER BY id'; }

result=build/pg-upgrade
test ! -L "$result"
mkdir -p "$result"
test ! -L "$result/report.json"
printf '%s\n' '{"result":"incomplete"}' > "$FOCUSPOCUS_QA_SCRATCH/report.json"
mv -f "$FOCUSPOCUS_QA_SCRATCH/report.json" "$result/report.json"
dc config --format json | python3 -B ops/check-test-network.py
dc up -d --wait --wait-timeout 120 db test-db
source_version=$(sql test-db 'SHOW server_version_num')
target_version=$(sql db 'SHOW server_version_num')
(( source_version / 10000 == 17 && target_version / 10000 == 18 ))
export FOCUSPOCUS_QA_DB_HOST=test-db
dc run --rm --no-deps migrate
dc up --no-deps -d --wait --wait-timeout 120 web worker
dc exec -T web python - < ops/performance/seed.py > /dev/null
dc exec -T web python - attach < ops/pg-upgrade/fixture.py
checkpoint="$FOCUSPOCUS_QA_SCRATCH/probe-checkpoint"
python3 -B ops/qa-replacement.py before "$checkpoint"
expected=$(digest)
[[ $expected =~ ^[a-f0-9]{64}$ ]]
before_generation=$(generations test-db)
test -n "$before_generation"
db_size=$(sql test-db 'SELECT pg_database_size(current_database())')

# Quiesce both source writers. The PG18 client reads PG17 over the private network.
start=$SECONDS
dc stop web worker
dc exec -T db sh -ec '
  PGPASSWORD=$(cat /run/secrets/database-admin)
  export PGPASSWORD
  exec pg_dump --no-password --host=test-db -U postgres --format=custom --dbname=focuspocus
' > "$FOCUSPOCUS_QA_SCRATCH/logical.dump"
archive_size=$(wc -c < "$FOCUSPOCUS_QA_SCRATCH/logical.dump")
dc stop test-db
test "$(sql db "SELECT to_regclass('public.core_item') IS NULL")" = t
dc exec -T db pg_restore --single-transaction --exit-on-error --no-owner --no-acl \
  -U fpmigrate -d focuspocus < "$FOCUSPOCUS_QA_SCRATCH/logical.dump"
export FOCUSPOCUS_QA_DB_HOST=db
dc run --rm --no-deps migrate
dc run --rm --no-deps migrate python manage.py migrate --check
test "$(digest)" = "$expected"
test "$(generations db)" = "$before_generation"
dc run --rm --no-deps web python manage.py fence_restored_database
test "$(generations db)" != "$before_generation"
test "$(digest)" = "$expected"
dc up --no-deps -d --wait --wait-timeout 120 web worker
dc exec -T worker python manage.py worker_health
image_id=$(docker image inspect --format '{{.Id}}' "$FOCUSPOCUS_IMAGE")
for service in web worker; do
  test "$(docker inspect --format '{{.Image}}' "$(dc ps -q "$service")")" = "$image_id"
done
python3 -B ops/qa-replacement.py after "$checkpoint"
elapsed=$((SECONDS - start))
test "$(digest)" != "$expected"

# Reopen the old database in isolation and prove the target write never reached it.
dc up -d --wait --wait-timeout 120 test-db
export FOCUSPOCUS_QA_DB_HOST=test-db
test "$(digest)" = "$expected"
test "$(generations test-db)" = "$before_generation"
python3 - "$FOCUSPOCUS_QA_SCRATCH/report.json" "$EXPECTED_ARCH" "$image_id" "$source_version" "$target_version" \
  "$db_size" "$archive_size" "$elapsed" "$expected" <<'PY'
import json
from pathlib import Path
import sys

path, arch, image, old, new, size, archive_size, elapsed, digest = sys.argv[1:]
report = dict(result="passed", platform=arch, applicationImageId=image, sourceServerVersion=int(old),
              targetServerVersion=int(new), sourceDatabaseBytes=int(size), archiveBytes=int(archive_size),
              secondsToVerifiedTarget=int(elapsed), sourceContentSha256=digest, benchmarkActions=10_000,
              groups=1_000, projects=100, notes=434, attachmentBytes=1_048_576,
              fenced=True, sourcePreserved=True, authenticatedCaptureAndIsolation=True)
Path(path).write_text(json.dumps(report, indent=2) + "\n")
PY
mv -f "$FOCUSPOCUS_QA_SCRATCH/report.json" "$result/report.json"
cat "$result/report.json"
