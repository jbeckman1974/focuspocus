"""Promote the two exact native images qualified by this release workflow."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


PLATFORMS = ("amd64", "arm64")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


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


def stage_image(repo, architecture, directory, commit, build):
    root = directory / ("candidate-" + architecture)
    record = json.loads((root / "qualified.json").read_text())
    if record["commit"] != commit or record["platform"] != "linux/" + architecture:
        raise ValueError("Candidate is from another commit or architecture")
    image = root / "image.tar"
    with image.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != record["archive_sha256"]:
            raise ValueError("Image archive checksum mismatch")
    docker("load", "--input", str(image))
    ref = "focuspocus-candidate:" + architecture
    config = json.loads(docker("image", "inspect", ref))[0]
    if (config["Id"], config["Os"], config["Architecture"]) != (record["id"], "linux", architecture):
        raise ValueError("Loaded image differs from tested image")
    target = f"{repo}:{build}-{architecture}"
    docker("tag", ref, target)
    docker("push", "--platform", "linux/" + architecture, target)
    digest = inspect_digest(target)
    manifest = json.loads(docker("buildx", "imagetools", "inspect", "--raw", repo + "@" + digest))
    if manifest["config"]["digest"] != config["Id"]:
        raise ValueError("Registry platform manifest has the wrong image configuration")
    return digest


def publish(repo, version, commit, run, attempt, directory):
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Expected a semantic release version")
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not run.isdecimal() or not attempt.isdecimal():
        raise ValueError("Invalid release provenance")
    build = f"{version}-b{run}-{attempt}"
    expected = {arch: stage_image(repo, arch, directory, commit, build) for arch in PLATFORMS}
    qualified = repo + ":ci-" + run + "-" + attempt
    args = [repo + "@" + expected[arch] for arch in PLATFORMS]
    docker("buildx", "imagetools", "create", "--tag", qualified, *args)
    digest = inspect_digest(qualified)
    ref = repo + "@" + digest
    verify_index(json.loads(docker("buildx", "imagetools", "inspect", "--raw", ref)), expected)
    for tag in (version, build):
        target = repo + ":" + tag
        current = inspect_digest(target, optional=True)
        if tag == version and current:
            continue  # Maintenance builds retain the original version tag.
        if current and current != digest:
            raise ValueError(f"Version or build tag already has another digest: {tag}")
        if not current:
            docker("buildx", "imagetools", "create", "--tag", target, ref)
        if inspect_digest(target) != digest:
            raise ValueError(f"Readback failed for {tag}")
    stable = repo + ":stable"
    previous = inspect_digest(stable, optional=True)
    if previous:
        old = repo + "@" + previous
        docker("pull", "--platform", "linux/amd64", old)
        metadata = json.loads(docker("image", "inspect", old))[0]
        old_version = metadata["Config"]["Labels"]["org.opencontainers.image.version"]
        if not re.fullmatch(r"v\d+\.\d+\.\d+", old_version):
            raise ValueError("Cannot establish the current stable version")
    if not previous or tuple(map(int, old_version[1:].split("."))) <= tuple(map(int, version[1:].split("."))):
        docker("buildx", "imagetools", "create", "--tag", stable, ref)
        if inspect_digest(stable) != digest:
            raise ValueError("Stable tag readback failed")
    print(json.dumps(dict(version=version, build=build, source=commit, index=digest, platforms=expected)))


if __name__ == "__main__":
    publish(*sys.argv[1:6], Path(sys.argv[6]))
