#!/usr/bin/env bash
set -euo pipefail
: "${FOCUSPOCUS_ACCESSIBILITY_IMAGE:?Build the accessibility-tests frontend image first}"
: "${EXPECTED_ARCH:?Select a native validation architecture}"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$FOCUSPOCUS_ACCESSIBILITY_IMAGE")" = "linux/$EXPECTED_ARCH"
exec bash ops/performance/isolated-stack.sh bash ops/accessibility/run-browsers.sh
