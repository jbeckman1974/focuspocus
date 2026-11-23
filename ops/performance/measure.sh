#!/usr/bin/env bash
set -euo pipefail
set +x
: "${FOCUSPOCUS_QA_SCRATCH:?Use the isolated benchmark wrapper}"
: "${FOCUSPOCUS_QA_WEB_ID:?Use the isolated benchmark wrapper}"
scratch=$FOCUSPOCUS_QA_SCRATCH
umask 077
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$FOCUSPOCUS_TEST_BROWSER_IMAGE")" = "linux/$EXPECTED_ARCH"
docker run --rm --network none "$FOCUSPOCUS_TEST_BROWSER_IMAGE" \
  node --test integration/readiness-performance/statistics.test.ts
docker exec -i "$FOCUSPOCUS_QA_WEB_ID" python - --browser-benchmark < ops/performance/seed.py > "$scratch/accounts.json"
# The containing directory is 0700. Mount just the selected file into the browser.
chmod 0444 "$scratch/accounts.json"
touch "$scratch/browser.json"
chmod 0666 "$scratch/browser.json"
status=0
docker run --rm --init --shm-size=512m --network "container:$FOCUSPOCUS_QA_WEB_ID" \
  --mount "type=bind,source=$scratch/accounts.json,target=/run/qa-accounts.json,readonly" \
  --mount "type=bind,source=$scratch/browser.json,target=/run/benchmark-report.json" \
  "$FOCUSPOCUS_TEST_BROWSER_IMAGE" ./node_modules/.bin/playwright test \
  -c integration/readiness-performance/config.ts || status=$?
python3 -B ops/performance/report.py "$scratch" "$status"
exit "$status"
