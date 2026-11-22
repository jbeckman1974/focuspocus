#!/usr/bin/env bash
# Test the supplied native production image using one M7 qualification.
set -euo pipefail
: "${FOCUSPOCUS_IMAGE:?Supply a locally built application image}"
: "${EXPECTED_ARCH:?Supply its native architecture}"
bash ops/assert-native.sh
case "${1:-}" in
  performance)
    if [[ -z ${FOCUSPOCUS_TEST_BROWSER_IMAGE:-} ]]; then
      FOCUSPOCUS_TEST_BROWSER_IMAGE=$(docker build --quiet --target browser-tests frontend)
      export FOCUSPOCUS_TEST_BROWSER_IMAGE
    fi
    bash ops/performance/verify.sh
    test -s build/performance/report.json && test -s build/performance/SHA256SUMS
    ;;
  accessibility)
    if [[ -z ${FOCUSPOCUS_ACCESSIBILITY_IMAGE:-} ]]; then
      FOCUSPOCUS_ACCESSIBILITY_IMAGE=$(docker build --quiet --target accessibility-tests frontend)
      export FOCUSPOCUS_ACCESSIBILITY_IMAGE
    fi
    bash ops/accessibility/verify.sh
    ;;
  pg-upgrade)
    bash ops/pg-upgrade/verify.sh
    test -s build/pg-upgrade/report.json
    ;;
  *) echo "Select performance, accessibility or pg-upgrade." >&2; exit 2 ;;
esac
