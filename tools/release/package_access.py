"""Confirm the personal GHCR package is private before sending application layers."""

import json
import os
import re
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


def check_package(owner, name):
    """The owner prepares a private marker before allowing repository Actions to write."""
    package = f"{owner}/{name}"
    # GitHub's /users/{name}/packages endpoint documents only public personal packages.
    # A missing entry alone says nothing about whether this workflow can pull a private image.
    visibility = management_visibility(owner, name)
    if visibility is not None and visibility != "private":
        raise ValueError(f"GitHub reports {package} is {visibility}; private publication is required")
    marker = "ghcr.io/" + package + ":visibility-check"
    digest = inspect_digest(marker, optional=True)
    if not digest:
        raise ValueError("A pre-provisioned private package marker and Actions read access are required")
    immutable = "ghcr.io/" + package + "@" + digest
    if inspect_digest(immutable) != digest:
        raise ValueError("Authenticated access to the immutable marker could not be verified")
    verify_private(package)
    verify_private(package, digest)
    print(f"Authenticated read of {package}'s marker succeeded; anonymous reads were denied.")


if __name__ == "__main__":
    check_package(*identity())
