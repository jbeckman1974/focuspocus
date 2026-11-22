#!/usr/bin/env bash
# Recheck the selected main tip before qualifying, publishing or promoting a manual build.
set -euo pipefail
if [[ "$GITHUB_EVENT_NAME" == workflow_dispatch ]]; then
  test "$GITHUB_REF" = refs/heads/main
  head=$(git ls-remote --exit-code origin refs/heads/main | cut -f1)
  test "$GITHUB_SHA" = "$head"
fi
