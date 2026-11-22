#!/bin/sh
set -eu
: "${EXPECTED_ARCH:?set EXPECTED_ARCH to amd64 or arm64}"
daemon=$(docker info --format '{{.OSType}}/{{.Architecture}}')
case "$EXPECTED_ARCH:$(uname -s):$(uname -m):$daemon" in
    amd64:Linux:x86_64:linux/x86_64|amd64:Linux:x86_64:linux/amd64) ;;
    arm64:Linux:aarch64:linux/aarch64|arm64:Linux:aarch64:linux/arm64) ;;
    arm64:Darwin:arm64:linux/aarch64|arm64:Darwin:arm64:linux/arm64) ;;
    *) echo "Native platform mismatch: expected $EXPECTED_ARCH; host $(uname -sm); daemon $daemon" >&2; exit 1 ;;
esac
echo "Verified $(uname -sm) and $daemon"
