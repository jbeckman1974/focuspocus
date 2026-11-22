#!/usr/bin/env bash
# Each hosted runner has its own Docker credentials.
set -euo pipefail
set +x
printf '%s' "${REGISTRY_TOKEN:?}" | docker login ghcr.io -u "${GITHUB_ACTOR:?}" --password-stdin
python3 tools/release/package_access.py
