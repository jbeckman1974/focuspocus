"""Check whether an anonymous client can read the project's GHCR package."""

import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def anonymous_read(path, headers=None):
    request = Request("https://ghcr.io/" + path, headers=headers or {})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def verify_private(package, digest=None, read=anonymous_read):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*", package):
        raise ValueError("Expected an owner and repository")
    if digest is not None and not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("Invalid staged image digest")
    query = urlencode({"service": "ghcr.io", "scope": f"repository:{package}:pull"})
    try:
        token = read("token?" + query)["token"]
        resource = "manifests/" + digest if digest else "tags/list?n=1"
        read(f"v2/{package}/{resource}", {
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json",
        })
    except HTTPError as error:
        if error.code in {401, 403} or (digest is None and error.code == 404):
            return
        raise
    raise ValueError("Package is readable without authentication; private publication required")


if __name__ == "__main__":
    package = os.environ["GITHUB_REPOSITORY_OWNER"].lower() + "/" + Path("release/package").read_text().strip()
    verify_private(package, sys.argv[1] if len(sys.argv) > 1 else None)
