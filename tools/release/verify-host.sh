#!/usr/bin/env bash
# Verify an already-running release on its deployment host.
set -euo pipefail
: "${FOCUSPOCUS_IMAGE:?Set the approved GHCR repository and index digest}"
: "${FOCUSPOCUS_ORIGIN:?Set the HTTPS origin on the production proxy}"
[[ "$FOCUSPOCUS_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]
[[ "$FOCUSPOCUS_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]
test "$(uname -sm)" = "Linux x86_64"
. /etc/os-release
test "$ID" = opensuse-tumbleweed
export EXPECTED_ARCH=amd64
bash ops/assert-native.sh
compose=(docker compose -f compose.yaml)
index=$(docker buildx imagetools inspect --raw "$FOCUSPOCUS_IMAGE")
child=$(jq -er '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest] | select(length == 1) | .[0]' <<<"$index")
repo=${FOCUSPOCUS_IMAGE%@*}
config=$(docker buildx imagetools inspect --raw "$repo@$child" | jq -er '.config.digest')
for service in web worker; do
  cid=$("${compose[@]}" ps -q "$service")
  test "$(docker inspect --format '{{.Image}}' "$cid")" = "$config"
  test "$(docker inspect --format '{{.State.Health.Status}}' "$cid")" = healthy
done
migration=$("${compose[@]}" ps --all --quiet migrate)
test -n "$migration"
test "$(docker inspect --format '{{.Image}}/{{.State.Status}}/{{.State.ExitCode}}' "$migration")" = "$config/exited/0"
"${compose[@]}" exec -T web python manage.py migrate --check
"${compose[@]}" exec -T worker python manage.py worker_health
curl --fail --silent --show-error --max-time 15 "$FOCUSPOCUS_ORIGIN/api/v1/health/ready" >/dev/null
case "${FOCUSPOCUS_SYNTHETIC_CHECK:-0}" in
  0) echo "Runtime checks passed. Authenticated deployment acceptance is pending." ;;
  1) python3 tools/release/synthetic_probe.py ;;
  *) echo "FOCUSPOCUS_SYNTHETIC_CHECK must be 0 or 1." >&2; exit 1 ;;
esac
printf '%s\n' "Verified $PRETTY_NAME, kernel $(uname -r), index $FOCUSPOCUS_IMAGE, AMD64 manifest $child."
