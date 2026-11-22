"""Exercise the synthetic API probe across replacement inside verify-stack's disposable project."""

import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/release"))
from synthetic_probe import ProbeError, verify_capture


def compose(*args, stdin=None):
    return subprocess.run(
        ["docker", "compose", "-f", "compose.yaml", *args], input=stdin,
        text=True, stdout=subprocess.PIPE, check=True,
    ).stdout.strip()


def provision():
    username = "focuspocus-smoke-" + secrets.token_hex(10)
    password = secrets.token_urlsafe(32)
    compose("exec", "-T", "web", "python", "manage.py", "provision_account",
            username, "--password-file", "/dev/stdin", stdin=password)
    lookup = (
        "import django,sys; django.setup(); from core.models import Workspace; "
        "print(Workspace.objects.get(private_owner__username=sys.argv[1]).pk)"
    )
    workspace = compose("exec", "-T", "web", "python", "-c", lookup, username)
    return {"username": username, "password": password, "workspace": str(UUID(workspace))}


def run(phase, checkpoint):
    if os.environ.get("APP_ENV") != "development" or not re.fullmatch(
        r"focuspocus-qa-stack-[a-z0-9]+", os.environ.get("COMPOSE_PROJECT_NAME", "")
    ):
        raise ProbeError("Replacement checks require a disposable native QA stack.")
    port = compose("port", "web", "8000")
    if not re.fullmatch(r"127\.0\.0\.1:[0-9]+", port):
        raise ProbeError("The disposable service must bind to a loopback port.")
    origin = "http://" + port
    if phase == "before":
        owner, neighbor = provision(), provision()
        first = verify_capture(origin, owner, neighbor, previous=[])
        order = verify_capture(origin, owner, neighbor, previous=first)
        fd = os.open(checkpoint, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump([owner, neighbor, order], target)
    elif phase == "after":
        with open(checkpoint, encoding="utf-8") as source:
            owner, neighbor, order = json.load(source)
        verify_capture(origin, owner, neighbor, previous=order)
    else:
        raise ProbeError("Unknown replacement phase.")


if __name__ == "__main__":
    try:
        run(*sys.argv[1:])
    except ProbeError as error:
        sys.exit(str(error))
