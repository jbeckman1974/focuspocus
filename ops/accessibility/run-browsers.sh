#!/usr/bin/env bash
# Run only inside the per-invocation stack created by isolated-stack.sh.
set -euo pipefail
set +x
: "${FOCUSPOCUS_QA_WEB_ID:?Disposable web service is required}"
: "${FOCUSPOCUS_QA_SCRATCH:?Disposable secret directory is required}"
[[ ${APP_ENV:-} == development && $COMPOSE_PROJECT_NAME =~ ^focuspocus-qa-stack-[a-f0-9]{32}$ ]]
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$FOCUSPOCUS_QA_WEB_ID")
[[ $project == "$COMPOSE_PROJECT_NAME" ]]
umask 077
failed=0
for engine in chromium firefox webkit; do
  accounts="$FOCUSPOCUS_QA_SCRATCH/$engine-accounts.json"
  python3 - "$accounts" <<'PY'
import json
from pathlib import Path
import secrets
import sys

accounts = {
    role: {"username": "qa_" + secrets.token_hex(10), "password": secrets.token_urlsafe(32)}
    for role in ("owner", "neighbor", "planner")
}
Path(sys.argv[1]).write_text(json.dumps(accounts), encoding="utf-8")
PY
  docker exec -i "$FOCUSPOCUS_QA_WEB_ID" python -c '
import json, sys
import django
django.setup()
from core.auth_services import provision_account
for account in json.load(sys.stdin).values():
    provision_account(account["username"], account["password"])
' < "$accounts"
  # The container has a different UID. On the host the enclosing directory is 0700.
  chmod 0444 "$accounts"
  browser_status=0
  docker run --rm --init --shm-size=512m --network "container:$FOCUSPOCUS_QA_WEB_ID" \
    --mount "type=bind,source=$accounts,target=/run/qa-accounts.json,readonly" \
    "$FOCUSPOCUS_ACCESSIBILITY_IMAGE" --project "$engine" || browser_status=$?
  rm -f -- "$accounts"
  if (( browser_status >= 128 )); then exit "$browser_status"; fi
  if (( browser_status != 0 )); then failed=1; fi
done
exit "$failed"
