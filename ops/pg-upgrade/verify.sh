#!/usr/bin/env bash
set -euo pipefail
exec bash ops/performance/isolated-stack.sh --pg-upgrade bash ops/pg-upgrade/rehearse.sh
