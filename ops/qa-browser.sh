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
trap 'rm -f -- "$qa_dir/accounts.json"; rmdir -- "$qa_dir"' EXIT
umask 077
python3 - "$qa_dir/accounts.json" <<'PY'
import json
from pathlib import Path
import secrets
import sys

accounts = {
    role: {"username": "qa_" + secrets.token_hex(10), "password": secrets.token_urlsafe(32)}
    for role in ("owner", "neighbor")
}
Path(sys.argv[1]).write_text(json.dumps(accounts), encoding="utf-8")
PY
read_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]][sys.argv[2]])' "$1" "$2" < "$qa_dir/accounts.json"
}
for role in owner neighbor; do
  username=$(read_field "$role" username)
  read_field "$role" password | "${compose[@]}" exec -T web python manage.py provision_account "$username" --password-file /dev/stdin
done
# The enclosing host directory is private. The browser runs as its own non-root UID.
chmod 0444 "$qa_dir/accounts.json"
browser_image="focuspocus-browser:${COMPOSE_PROJECT_NAME}"
docker build --target browser-tests --tag "$browser_image" frontend
docker run --rm --init --shm-size=512m --network "container:$web_id" \
  --mount "type=bind,source=$qa_dir/accounts.json,target=/run/qa-accounts.json,readonly" \
  "$browser_image" npm run test:integration
