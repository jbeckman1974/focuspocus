"""Confirm the personal GHCR package is private before sending application layers."""

import json
import os
import re
import subprocess
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from publish import inspect_digest
from visibility import verify_private


def identity():
    owner = os.environ["GITHUB_REPOSITORY_OWNER"].lower()
    name = Path("release/package").read_text().strip()
    if not all(re.fullmatch(r"[a-z0-9][a-z0-9.-]*", part) for part in (owner, name)):
        raise ValueError("Invalid GHCR owner or package")
    return owner, name


def management_visibility(owner, name):
    request = Request(f"https://api.github.com/users/{owner}/packages/container/{name}")
    request.add_unredirected_header("Authorization", "Bearer " + os.environ["REGISTRY_TOKEN"])
    request.add_header("Accept", "application/vnd.github+json")
    try:
        with urlopen(request, timeout=20) as response:
            data = json.load(response)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise
    if (data.get("name"), data.get("package_type"), data.get("owner", {}).get("login", "").lower()) != (
        name, "container", owner
    ):
        raise ValueError("GitHub returned metadata for another package")
    return data["visibility"]


def push_empty_marker(ref):
    # A Dockerfile-only build has no checkout files and no application layers.
    dockerfile = "FROM scratch\nLABEL org.opencontainers.image.title=package-visibility-check\n"
    subprocess.run(["docker", "build", "--tag", ref, "-"], input=dockerfile, text=True, check=True)
    subprocess.run(["docker", "push", "--platform", "linux/amd64", ref], check=True)


def check_package(owner, name, *, bootstrap=False):
    package = f"{owner}/{name}"
    visibility = management_visibility(owner, name)
    marker = "ghcr.io/" + package + ":visibility-check"
    if visibility is None and bootstrap:
        verify_private(package)
        push_empty_marker(marker)
        visibility = management_visibility(owner, name)
    if visibility != "private":
        raise ValueError(f"GitHub must confirm {package} is private (reported {visibility or 'unavailable'})")
    verify_private(package)
    if bootstrap:
        digest = inspect_digest(marker, optional=True)
        if not digest:
            push_empty_marker(marker)
            digest = inspect_digest(marker)
        verify_private(package, digest)
    print(f"GitHub confirms {package} is private and anonymous package access was denied.")


if __name__ == "__main__":
    import sys

    if sys.argv[1:] not in ([], ["--bootstrap"]):
        raise SystemExit("Use --bootstrap only on the trusted release preflight")
    check_package(*identity(), bootstrap=bool(sys.argv[1:]))
