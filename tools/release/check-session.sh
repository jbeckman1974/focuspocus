#!/usr/bin/env bash
# Each hosted runner has its own Docker credentials.
set -euo pipefail
set +x
python3 tools/release/visibility.py
printf '%s' "${REGISTRY_TOKEN:?}" | docker login ghcr.io -u "${GITHUB_ACTOR:?}" --password-stdin
