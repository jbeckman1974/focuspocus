"""Promote the two exact native images qualified by this release workflow."""

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


def stage_image(repo, architecture, directory, commit):
    root = directory / ("candidate-" + architecture)
    record = json.loads((root / "qualified.json").read_text())
    if record["commit"] != commit or record["platform"] != "linux/" + architecture:
        raise ValueError("Candidate is from another commit or architecture")
    digest = record["digest"]
    if not DIGEST.fullmatch(digest) or not DIGEST.fullmatch(record["id"]):
        raise ValueError("Invalid tested image identity")
    manifest = json.loads(docker("buildx", "imagetools", "inspect", "--raw", repo + "@" + digest))
    if manifest["config"]["digest"] != record["id"]:
        raise ValueError("Registry platform manifest has the wrong image configuration")
    return digest


def verify_previous_version(repo, digest, version, commit):
    index = json.loads(docker("buildx", "imagetools", "inspect", "--raw", repo + "@" + digest))
    children = {entry["platform"]["architecture"]: entry["digest"] for entry in index["manifests"]}
    verify_index(index, children)
    for arch, child in children.items():
        ref = repo + "@" + child
        docker("pull", "--platform", "linux/" + arch, ref)
        image = json.loads(docker("image", "inspect", ref))[0]
        labels = image["Config"]["Labels"]
        if (image["Os"], image["Architecture"], labels.get("org.opencontainers.image.version"),
                labels.get("org.opencontainers.image.revision")) != ("linux", arch, version, commit):
            raise ValueError("Existing version has incompatible source or platform")


def publish(repo, version, commit, run, attempt, directory):
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Expected a semantic release version")
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not run.isdecimal() or not attempt.isdecimal():
        raise ValueError("Invalid release provenance")
    build = f"{version}-b{run}-{attempt}"
    expected = {arch: stage_image(repo, arch, directory, commit) for arch in PLATFORMS}
    qualified = repo + ":ci-" + run + "-" + attempt
    args = [repo + "@" + expected[arch] for arch in PLATFORMS]
    docker("buildx", "imagetools", "create", "--tag", qualified, *args)
    digest = inspect_digest(qualified)
    ref = repo + "@" + digest
    verify_index(json.loads(docker("buildx", "imagetools", "inspect", "--raw", ref)), expected)
    version_digest = digest
    for tag in (version, build):
        target = repo + ":" + tag
        current = inspect_digest(target, optional=True)
        if tag == version and current:
            verify_previous_version(repo, current, version, commit)
            version_digest = current
            continue  # Maintenance builds retain the original version tag.
        if current and current != digest:
            raise ValueError(f"Version or build tag already has another digest: {tag}")
        if not current:
            docker("buildx", "imagetools", "create", "--tag", target, ref)
        if inspect_digest(target) != digest:
            raise ValueError(f"Readback failed for {tag}")
    return {
        "version": version, "version_index": version_digest, "build": build, "source": commit,
        "index": digest, "platforms": expected,
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



if __name__ == "__main__":
    if sys.argv[1] == "stage":
        print(json.dumps(publish(*sys.argv[2:7], Path(sys.argv[7]))))
    elif sys.argv[1] == "promote":
        promote_stable(sys.argv[2], json.loads(sys.argv[3]))
    else:
        raise SystemExit("Expected stage or promote")
