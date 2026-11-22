#!/usr/bin/env bash
# Run only against the disposable Compose project created by verify-stack.sh.
set -euo pipefail
set +x
: "${COMPOSE_PROJECT_NAME:?Pass the isolated QA Compose project}"
: "${FOCUSPOCUS_SECRET_DIR:?Pass the isolated QA stack secret directory}"
if [[ ${APP_ENV:-} != development ]]; then
  echo "Browser fixtures require the disposable development-mode QA stack." >&2
  exit 1
fi
compose=(docker compose -f compose.yaml)
web_id=$("${compose[@]}" ps -q web)
if [[ -z $web_id ]]; then
  echo "The QA web container is not running." >&2
  exit 1
fi

mkdir -p build
qa_dir=$(mktemp -d "$PWD/build/browser-accounts.XXXXXXXX")
browser_image="focuspocus-browser:${qa_dir##*/}"
test_args=()
extra_env=()
if [[ -n ${FOCUSPOCUS_TEST_BROWSER_IMAGE:-} ]]; then
  browser_image=$FOCUSPOCUS_TEST_BROWSER_IMAGE
fi
cleanup() {
  local code=$?
  rm -f -- "$qa_dir/accounts.json"
  rmdir -- "$qa_dir"
  if [[ -z ${FOCUSPOCUS_TEST_BROWSER_IMAGE:-} ]] && docker image inspect "$browser_image" >/dev/null 2>&1; then
    docker image rm "$browser_image" >/dev/null || code=1
  fi
  exit "$code"
}
trap cleanup EXIT
umask 077
if [[ $# == 2 && $1 == recovery ]]; then
  [[ ${FOCUSPOCUS_QA_RESTORE_HOST:-} == "$COMPOSE_PROJECT_NAME-restored-web" ]]
  # Use the disposable owner present in both the running database and SQL dump.
  python3 - "$2" "$qa_dir/accounts.json" <<'PY'
import json
from pathlib import Path
import sys

owner = json.loads(Path(sys.argv[1]).read_text())[0]
Path(sys.argv[2]).write_text(json.dumps({"owner": {k: owner[k] for k in ("username", "password")}}))
PY
  test_args=(-- offline-restore.spec.ts)
  extra_env=(-e FOCUSPOCUS_QA_RESTORE_HOST)
elif [[ $# == 0 ]]; then
  python3 - "$qa_dir/accounts.json" <<'PY'
import json
from pathlib import Path
import secrets
import sys

# Pre-M6 planning and preferences share an owner for the restore assertions.
# Each new independent suite gets its own identities and ordinary login budget.
targets = sorted(Path("frontend/integration").glob("offline*.spec.ts"))
targets += [Path("public-shell.spec.ts"), Path("touch-workspace.spec.ts")]
prefixes = [""] + [path.name + "/" for path in targets if path.name != "offline-restore.spec.ts"]
accounts = {
    prefix + role: {"username": "qa_" + secrets.token_hex(10), "password": secrets.token_urlsafe(32)}
    for prefix in prefixes for role in ("owner", "neighbor", "planner")
}
Path(sys.argv[1]).write_text(json.dumps(accounts), encoding="utf-8")
PY
  "${compose[@]}" exec -T web python -c '
import json, sys
import django
django.setup()
from core.auth_services import provision_account
for account in json.load(sys.stdin).values():
    provision_account(account["username"], account["password"])
' < "$qa_dir/accounts.json"
else
  exit 2
fi
# The enclosing host directory is private. The browser runs as its own non-root UID.
chmod 0444 "$qa_dir/accounts.json"
if [[ -z ${FOCUSPOCUS_TEST_BROWSER_IMAGE:-} ]]; then
  docker build --target browser-tests --tag "$browser_image" frontend
fi
docker run --rm --init --shm-size=512m --network "container:$web_id" \
  --mount "type=bind,source=$qa_dir/accounts.json,target=/run/qa-accounts.json,readonly" \
  "${extra_env[@]}" "$browser_image" npm run test:integration "${test_args[@]}"
