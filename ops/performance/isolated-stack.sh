#!/usr/bin/env bash
# Run a qualification inside its own Compose project and storage allocation.
set -euo pipefail
set +x
: "${FOCUSPOCUS_IMAGE:?Build the application image first}"
: "${EXPECTED_ARCH:?Select a native validation architecture}"
prepare_upgrade=false
if [[ ${1:-} == --pg-upgrade ]]; then
  prepare_upgrade=true
  shift
fi
(( $# > 0 ))
test -f ops/db-init.sh
test ! -L build
mkdir -p build
export FOCUSPOCUS_QA_SCRATCH
FOCUSPOCUS_QA_SCRATCH=$(mktemp -d "$(pwd -P)/build/qa-readiness.XXXXXXXXXX")
nonce=$(python3 -c 'import uuid; print(uuid.uuid4().hex)')
export COMPOSE_PROJECT_NAME="focuspocus-qa-stack-$nonce"
export FOCUSPOCUS_SECRET_DIR="$FOCUSPOCUS_QA_SCRATCH/secrets" APP_ENV=development
export FOCUSPOCUS_PORT=0 ALLOWED_HOSTS=127.0.0.1,localhost,web COMPOSE_DISABLE_ENV_FILE=1 TRUST_HTTPS_PROXY=0
compose=(docker compose -f compose.yaml -f ops/compose.tests.yaml --profile testing)
if $prepare_upgrade; then compose+=(-f ops/pg-upgrade/compose.yaml); fi
cleanup() {
  code=$?
  if [[ $started == false ]] || "${compose[@]}" down -v; then
    rm -rf -- "$FOCUSPOCUS_QA_SCRATCH"
  else
    echo "Disposable project $COMPOSE_PROJECT_NAME still needs cleanup." >&2
    code=1
  fi
  exit "$code"
}
started=false
trap cleanup EXIT
if [[ -n ${FOCUSPOCUS_TEST_DATA_DIR:-} ]]; then
  [[ ${FOCUSPOCUS_TEST_DATA_DIR##*/} =~ ^qa-([a-f0-9]{32})$ ]]
  export COMPOSE_PROJECT_NAME="focuspocus-qa-stack-${BASH_REMATCH[1]}"
  compose+=(-f ops/compose.host-test.yaml)
fi
own="label=com.docker.compose.project=$COMPOSE_PROJECT_NAME"
[[ -z $(docker ps -aq --filter "$own") && -z $(docker volume ls -q --filter "$own") &&
   -z $(docker network ls -q --filter "$own") ]]
bash ops/assert-native.sh
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$FOCUSPOCUS_IMAGE")" = "linux/$EXPECTED_ARCH"
python3 ops/init-secrets.py "$FOCUSPOCUS_SECRET_DIR"
"${compose[@]}" config --format json | python3 -B ops/check-test-network.py
started=true
if $prepare_upgrade; then
  "$@"
  exit
fi
"${compose[@]}" up --wait --wait-timeout 120 -d db
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" up --wait --wait-timeout 120 -d web worker
export FOCUSPOCUS_QA_WEB_ID
FOCUSPOCUS_QA_WEB_ID=$("${compose[@]}" ps -q web)
test "$(docker inspect --format '{{.Image}}' "$FOCUSPOCUS_QA_WEB_ID")" = "$(docker image inspect --format '{{.Id}}' "$FOCUSPOCUS_IMAGE")"
"$@"
