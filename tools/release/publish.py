"""Promote the two exact native images qualified by this release workflow."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from provenance import DIGEST, REVISION, RUN_ATTEMPT, RUN_NUMBER, build_order, require_ancestor, require_original_version
from visibility import public_package, verify_public

PLATFORMS = ("amd64", "arm64")


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True)


def inspect_digest(ref, optional=False):
    command = ["docker", "buildx", "imagetools", "inspect", ref]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        if optional and re.search(r"manifest unknown|manifest_unknown|: not found\s*$", result.stderr, re.I):
            return None
        raise RuntimeError(f"Could not inspect {ref}: {result.stderr.strip()}")
    match = re.search(r"^Digest:\s+(sha256:[a-f0-9]{64})\s*$", result.stdout, re.M)
    if not match:
        raise ValueError(f"Missing registry digest for {ref}")
    return match.group(1)


def verify_index(index, expected):
    found = {}
    for child in index["manifests"]:
        platform = child["platform"]
        arch = platform["architecture"]
        if platform["os"] != "linux" or arch in found or not DIGEST.fullmatch(child["digest"]):
            raise ValueError("Unexpected platform or repeated image in release index")
        found[arch] = child["digest"]
    if set(found) != set(PLATFORMS) or found != expected:
        raise ValueError("Release index differs from the tested platform manifests")


def stage_image(repo, architecture, directory, commit, version, run_number, attempt):
    root = directory / ("candidate-" + architecture)
    record = json.loads((root / "qualified.json").read_text())
    if record["commit"] != commit or record["platform"] != "linux/" + architecture:
        raise ValueError("Candidate is from another commit or architecture")
    if (record.get("version"), record.get("run_number"), record.get("run_attempt")) != (version, run_number, attempt):
        raise ValueError("Qualification records differ from this release attempt. Re-run all release jobs.")
    digest = record["digest"]
    if not DIGEST.fullmatch(digest) or not DIGEST.fullmatch(record["id"]):
        raise ValueError("Invalid tested image identity")
    ref = repo + "@" + digest
    manifest = json.loads(docker("buildx", "imagetools", "inspect", "--raw", ref))
    if manifest["config"]["digest"] != record["id"]:
        raise ValueError("Registry platform manifest has the wrong image configuration")
    docker("pull", "--platform", record["platform"], ref)
    image = json.loads(docker("image", "inspect", ref))[0]
    labels = image["Config"]["Labels"] or {}
    actual = (image["Os"], image["Architecture"], image["Id"], labels.get("org.opencontainers.image.version"),
              labels.get("org.opencontainers.image.revision"), labels.get(RUN_NUMBER), labels.get(RUN_ATTEMPT))
    if actual != ("linux", architecture, record["id"], version, commit, run_number, attempt):
        raise ValueError("Immutable registry image differs from its native qualification record")
    return digest


def verify_previous_version(repo, digest, version, commit):
    index = json.loads(docker("buildx", "imagetools", "inspect", "--raw", repo + "@" + digest))
    children = {entry["platform"]["architecture"]: entry["digest"] for entry in index["manifests"]}
    verify_index(index, children)
    sources = set()
    for arch, child in children.items():
        ref = repo + "@" + child
        docker("pull", "--platform", "linux/" + arch, ref)
        image = json.loads(docker("image", "inspect", ref))[0]
        labels = image["Config"]["Labels"]
        if (image["Os"], image["Architecture"], labels.get("org.opencontainers.image.version")) != ("linux", arch, version):
            raise ValueError("Existing version has incompatible version or platform")
        sources.add(labels.get("org.opencontainers.image.revision"))
    if len(sources) != 1:
        raise ValueError("Existing version has different sources on its two platforms")
    source = sources.pop()
    require_original_version(source, commit, version)
    return source


def publish(repo, version, commit, run, attempt, directory, run_number, maintenance=False):
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Expected a semantic release version")
    if not REVISION.fullmatch(commit) or not run.isdecimal():
        raise ValueError("Invalid release provenance")
    build_order(run_number, attempt)
    build = f"{version}-b{run}-{attempt}"
    expected = {arch: stage_image(repo, arch, directory, commit, version, run_number, attempt) for arch in PLATFORMS}
    qualified = repo + ":ci-" + run + "-" + attempt
    args = [repo + "@" + expected[arch] for arch in PLATFORMS]
    docker("buildx", "imagetools", "create", "--tag", qualified, *args)
    digest = inspect_digest(qualified)
    ref = repo + "@" + digest
    verify_index(json.loads(docker("buildx", "imagetools", "inspect", "--raw", ref)), expected)
    version_digest = digest
    version_source = commit
    for tag in (version, build):
        target = repo + ":" + tag
        current = inspect_digest(target, optional=True)
        if tag == version and maintenance and not current:
            raise ValueError("Manual maintenance requires an existing immutable version")
        if tag == version and current:
            version_source = verify_previous_version(repo, current, version, commit)
            version_digest = current
            continue  # Maintenance builds retain the original version tag.
        if current and current != digest:
            raise ValueError(f"Version or build tag already has another digest: {tag}")
        if not current:
            docker("buildx", "imagetools", "create", "--tag", target, ref)
        if inspect_digest(target) != digest:
            raise ValueError(f"Readback failed for {tag}")
    return {
        "version": version, "version_index": version_digest, "version_source": version_source,
        "build": build, "source": commit, "index": digest, "platforms": expected,
        "run_number": run_number, "run_attempt": attempt,
    }


def promote_stable(repo, release):
    version = release["version"]
    digest = release["index"]
    ref = repo + "@" + digest
    # Recheck both public tag mappings after the native jobs and before changing the channel.
    if (inspect_digest(repo + ":" + version) != release["version_index"]
            or inspect_digest(repo + ":" + release["build"]) != digest):
        raise ValueError("Version or build tag changed after native readback")
    stable = repo + ":stable"
    previous = inspect_digest(stable, optional=True)
    if previous == digest:
        return digest
    if previous:
        old = repo + "@" + previous
        docker("pull", "--platform", "linux/amd64", old)
        metadata = json.loads(docker("image", "inspect", old))[0]
        labels = metadata["Config"]["Labels"]
        old_version = labels["org.opencontainers.image.version"]
        if not re.fullmatch(r"v\d+\.\d+\.\d+", old_version):
            raise ValueError("Cannot establish the current stable version")
        if tuple(map(int, old_version[1:].split("."))) > tuple(map(int, version[1:].split("."))):
            return previous
        if old_version == version:
            old_source = labels.get("org.opencontainers.image.revision")
            require_ancestor(old_source, release["source"])
            if old_source == release["source"]:
                previous_order = build_order(labels.get(RUN_NUMBER), labels.get(RUN_ATTEMPT))
                if build_order(release["run_number"], release["run_attempt"]) <= previous_order:
                    raise ValueError("An earlier build of the same source cannot replace stable")
    docker("buildx", "imagetools", "create", "--tag", stable, ref)
    if inspect_digest(stable) != digest:
        raise ValueError("Stable tag readback failed")
    return digest


if __name__ == "__main__":
    if sys.argv[1] == "stage":
        release = publish(*sys.argv[2:7], Path(sys.argv[7]), sys.argv[8],
                          maintenance=os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch")
        print(json.dumps(release))
    elif sys.argv[1] == "promote":
        stable = promote_stable(sys.argv[2], json.loads(sys.argv[3]))
        verify_public(public_package(), "stable", stable)
        print("Verified public stable index", stable)
    else:
        raise SystemExit("Expected stage or promote")
