"""Assemble a pilot index from the exact two platform images that passed qualification."""

import json
import os
import sys
from pathlib import Path

from provenance import REVISION, build_order
from publish import PLATFORMS, docker, inspect_digest, stage_image, verify_index
from readback import verify_tag
from visibility import public_package, verify_public


def identity():
    commit = os.environ["GITHUB_SHA"]
    run = os.environ["GITHUB_RUN_ID"]
    number, attempt = os.environ["GITHUB_RUN_NUMBER"], os.environ["GITHUB_RUN_ATTEMPT"]
    if not REVISION.fullmatch(commit) or not run.isdecimal():
        raise ValueError("Invalid pilot build identity")
    build_order(number, attempt)
    version = "pilot-" + commit
    return version, f"{version}-{run}-{attempt}", commit, number, attempt


def stage(repo, directory):
    version, tag, commit, number, attempt = identity()
    tested = {arch: stage_image(repo, arch, directory, commit, version, number, attempt) for arch in PLATFORMS}
    target = repo + ":" + tag
    digest = inspect_digest(target, optional=True)
    if not digest:
        docker("buildx", "imagetools", "create", "--tag", target, *(repo + "@" + tested[arch] for arch in PLATFORMS))
        digest = inspect_digest(target)
    index = json.loads(docker("buildx", "imagetools", "inspect", "--raw", repo + "@" + digest))
    verify_index(index, tested)
    return digest


def readback(repo, arch, directory, digest):
    version, tag, commit, number, attempt = identity()
    candidate = json.loads((directory / "qualified.json").read_text())
    if arch not in PLATFORMS or candidate["platform"] != "linux/" + arch or os.environ.get("DOCKER_DEFAULT_PLATFORM"):
        raise ValueError("Pilot readback needs the native default platform and its qualification record")
    verify_public(public_package(), tag, digest)
    return verify_tag(repo, tag, digest, arch, version, commit, candidate, build_order(number, attempt))


if __name__ == "__main__":
    action, repo, *args = sys.argv[1:]
    if action == "stage":
        print(stage(repo, Path(args[0])))
    elif action == "readback":
        arch, directory, digest = args
        print(json.dumps(readback(repo, arch, Path(directory), digest)))
    else:
        raise SystemExit("Expected stage or readback")
