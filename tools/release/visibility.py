"""Verify anonymous access to the public GHCR package or an exact published manifest."""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from provenance import DIGEST


PUBLIC_PACKAGE = "jbeckman1974/focuspocus"
MANIFEST_TYPES = ",".join((
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
))
TAG = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}")


def public_package():
    name = Path("release/package").read_text().strip()
    destination = os.environ["GITHUB_REPOSITORY_OWNER"].lower() + "/" + name
    if os.environ["GITHUB_REPOSITORY"].lower() != PUBLIC_PACKAGE or destination != PUBLIC_PACKAGE:
        raise ValueError("Publication must use the FocusPocus repository and its public GHCR package")
    return destination


def anonymous_read(path, *, token=None, accept="application/json"):
    request = Request("https://ghcr.io/" + path, headers={"Accept": accept})
    if token:
        request.add_unredirected_header("Authorization", "Bearer " + token)
    with urlopen(request, timeout=20) as response:
        return response.read()


def verify_public(package, reference=None, expected_digest=None, *, read=anonymous_read):
    if package != PUBLIC_PACKAGE:
        raise ValueError("Unexpected public package")
    if reference is not None or expected_digest is not None:
        if not expected_digest or not DIGEST.fullmatch(expected_digest):
            raise ValueError("Expected a SHA-256 manifest digest")
        if not reference or (reference != expected_digest and not TAG.fullmatch(reference)):
            raise ValueError("Expected a tag or the same immutable digest")

    scope = urlencode({"service": "ghcr.io", "scope": f"repository:{package}:pull"})
    token = json.loads(read("token?" + scope))["token"]
    if not isinstance(token, str) or not token:
        raise ValueError("GHCR did not issue an anonymous pull token")
    if reference is None:
        listing = json.loads(read(f"v2/{package}/tags/list?n=1", token=token))
        if listing.get("name") != package or not isinstance(listing.get("tags"), list):
            raise ValueError("GHCR returned a listing for an unexpected package")
        return

    manifest = read(f"v2/{package}/manifests/{reference}", token=token, accept=MANIFEST_TYPES)
    if "sha256:" + hashlib.sha256(manifest).hexdigest() != expected_digest:
        raise ValueError("Anonymous manifest contents differ from the qualified digest")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", nargs="?")
    parser.add_argument("expected_digest", nargs="?")
    args = parser.parse_args()
    package = public_package()
    verify_public(package, args.reference, args.expected_digest)
    print(f"Verified anonymous GHCR access to {package}", end="")
    print(f" {args.reference} at {args.expected_digest}" if args.reference else "")
