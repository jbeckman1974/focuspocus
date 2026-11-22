#!/usr/bin/env bash
set -euo pipefail
: "${FOCUSPOCUS_TEST_BROWSER_IMAGE:?Build the frontend browser-tests image first}"
exec python3 -B ops/performance/run.py
