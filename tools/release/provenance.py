"""Compare release provenance with the reviewed repository history."""

import re
import subprocess


REVISION = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
RUN_NUMBER = "io.focuspocus.run-number"
RUN_ATTEMPT = "io.focuspocus.run-attempt"


def require_ancestor(ancestor, source):
    if not all(isinstance(value, str) and REVISION.fullmatch(value) for value in (ancestor, source)):
        raise ValueError("Invalid source revision")
    result = subprocess.run(["git", "merge-base", "--is-ancestor", ancestor, source])
    if result.returncode:
        raise ValueError("Prior source is outside the qualified commit's history")


def require_original_version(ancestor, source, version):
    require_ancestor(ancestor, source)
    manifest = subprocess.check_output(["git", "show", ancestor + ":release/version"], text=True)
    if manifest.strip() != version:
        raise ValueError("Prior source declares another release version")


def build_order(number, attempt):
    if not all(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]*", value) for value in (number, attempt)):
        raise ValueError("Invalid build sequence")
    return int(number), int(attempt)
