"""Check how a clean native Docker daemon resolves both published tags."""

import json
import os
import sys
from pathlib import Path

from provenance import RUN_ATTEMPT, RUN_NUMBER, build_order
from publish import DIGEST, PLATFORMS, docker, inspect_digest, verify_index


def verify_tag(repo, tag, index_digest, arch, version, commit, candidate=None, expected_order=None):
    tag_ref = repo + ":" + tag
    if not DIGEST.fullmatch(index_digest) or inspect_digest(tag_ref) != index_digest:
        raise ValueError(f"Unexpected index digest for {tag}")
    index = json.loads(docker("buildx", "imagetools", "inspect", "--raw", repo + "@" + index_digest))
    children = {entry["platform"]["architecture"]: entry["digest"] for entry in index["manifests"]}
    verify_index(index, children)
    child = children[arch]
    manifest = json.loads(docker("buildx", "imagetools", "inspect", "--raw", repo + "@" + child))
    config = manifest["config"]["digest"]
    if not DIGEST.fullmatch(config):
        raise ValueError(f"Invalid configuration digest for {tag}")
    if candidate and (child, config) != (candidate["digest"], candidate["id"]):
        raise ValueError(f"Tag {tag} differs from the native qualification record")

    # Omit --platform so a broken default selection fails the same way it would on the host.
    docker("pull", tag_ref)
    image = json.loads(docker("image", "inspect", tag_ref))[0]
    labels = image["Config"]["Labels"] or {}
    actual = (
        image["Os"], image["Architecture"], image["Id"],
        labels.get("org.opencontainers.image.version"), labels.get("org.opencontainers.image.revision"),
    )
    allowed_refs = {repo + "@" + digest for digest in (index_digest, child)}
    if actual != ("linux", arch, config, version, commit) or allowed_refs.isdisjoint(image["RepoDigests"]):
        raise ValueError(f"Default native pull of {tag} selected an unexpected image")
    if expected_order and build_order(labels.get(RUN_NUMBER), labels.get(RUN_ATTEMPT)) != expected_order:
        raise ValueError(f"Unexpected build sequence for {tag}")
    if inspect_digest(tag_ref) != index_digest:
        raise ValueError(f"Tag {tag} changed during native readback")
    return {"tag": tag, "index": index_digest, "child": child, "config": config, "source": commit}


def readback(repo, release, arch, candidate):
    commit = release["source"]
    version = release["version"]
    if arch not in PLATFORMS or candidate["platform"] != "linux/" + arch or candidate["commit"] != commit:
        raise ValueError("Invalid native qualification record")
    if candidate["digest"] != release["platforms"][arch]:
        raise ValueError("Published candidate identity differs from qualified platform")
    if os.environ.get("DOCKER_DEFAULT_PLATFORM"):
        raise ValueError("Native pull requires the daemon's default architecture")
    tested_version = candidate if release["version_index"] == release["index"] else None
    return [
        verify_tag(repo, version, release["version_index"], arch, version, release["version_source"], tested_version),
        verify_tag(repo, release["build"], release["index"], arch, version, commit, candidate,
                   build_order(release["run_number"], release["run_attempt"])),
    ]


if __name__ == "__main__":
    repo, release, arch, record = sys.argv[1:]
    print(json.dumps(readback(repo, json.loads(release), arch, json.loads(Path(record).read_text()))))
