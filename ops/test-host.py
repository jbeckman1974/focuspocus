"""Build and verify a clean FocusPocus revision on a native Tumbleweed x64 test host."""

import fcntl
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
from uuid import uuid4


LABEL = "io.github.focuspocus.test-run"
TARGETS = {"application": ".", "browser-tests": "frontend"}


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def image_tag(run_id, target):
    return f"localhost/focuspocus-test/{target}:{run_id}"


def tagged_id(tag):
    return output("docker", "image", "ls", "--no-trunc", "--quiet", "--filter", f"reference={tag}")


def cleanup(record):
    run_id = record.stem
    if not re.fullmatch(r"[0-9a-f]{32}", run_id) or record.is_symlink() or not record.is_file():
        raise ValueError(f"Unexpected test run record: {record}")
    complete = True
    for target in TARGETS:
        tag = image_tag(run_id, target)
        identity = tagged_id(tag)
        if not identity:
            continue
        owner = output("docker", "image", "inspect", "--format", f'{{{{index .Config.Labels "{LABEL}"}}}}', identity)
        if owner != run_id or output("docker", "ps", "-aq", "--filter", f"ancestor={identity}"):
            print(f"Preserving in-use or differently owned image {tag}.", file=sys.stderr)
            complete = False
            continue
        if tagged_id(tag) != identity:
            raise RuntimeError(f"Image tag changed during cleanup: {tag}")
        subprocess.run(["docker", "image", "rm", "--no-prune", tag], check=True)
    if complete:
        record.unlink()


def check_host(revision):
    if not re.fullmatch(r"[0-9a-f]{40}", revision) or output("git", "rev-parse", "HEAD") != revision:
        raise ValueError("Supply the full commit SHA checked out on the test host.")
    if Path(output("git", "rev-parse", "--show-toplevel")).resolve() != Path.cwd():
        raise ValueError("Run the host check from the repository root.")
    if output("git", "status", "--porcelain", "--untracked-files=normal"):
        raise ValueError("The test checkout has local modifications.")
    if platform.system() != "Linux" or platform.freedesktop_os_release()["ID"] != "opensuse-tumbleweed":
        raise ValueError("This host check requires openSUSE Tumbleweed.")

    context = output("docker", "context", "show")
    endpoint = output("docker", "context", "inspect", context, "--format", '{{(index .Endpoints "docker").Host}}')
    if not os.getenv("DOCKER_CONTEXT"):
        endpoint = os.getenv("DOCKER_HOST") or endpoint
    if not endpoint.startswith("unix:///") or not Path(endpoint[len("unix://"):]).is_socket():
        raise ValueError("This test needs a local Docker Engine Unix socket.")
    for key in list(os.environ):
        if key.startswith("COMPOSE_") or key in {"DOCKER_CONTEXT", "BUILDX_BUILDER", "BUILDKIT_HOST"}:
            del os.environ[key]
    os.environ.update(
        DOCKER_HOST=endpoint, EXPECTED_ARCH="amd64", DOCKER_DEFAULT_PLATFORM="linux/amd64",
        COMPOSE_DISABLE_ENV_FILE="1", TRUST_HTTPS_PROXY="0",
    )
    subprocess.run(["bash", "ops/assert-native.sh"], check=True)


def verify(revision, record, lock_fd):
    run_id = record.stem
    tags = {target: image_tag(run_id, target) for target in TARGETS}
    if any(tagged_id(tag) for tag in tags.values()):
        raise RuntimeError("A proposed test image tag already exists.")
    record.touch(exist_ok=False)
    # A surviving build or stack check keeps the checkout locked if its parent is interrupted.
    def run(*args, env=None):
        subprocess.run(args, check=True, pass_fds=(lock_fd,), env=env)

    try:
        for target, context in TARGETS.items():
            run(
                "docker", "build", "--target", target, "--label", f"{LABEL}={run_id}",
                "--label", f"org.opencontainers.image.revision={revision}", "--tag", tags[target], context,
            )
        browser = tags["browser-tests"]
        run("docker", "run", "--rm", "--network", "none", browser, "npm", "run", "check")
        run(
            "docker", "run", "--rm", "--network", "none", "--shm-size=512m", "-e", "CI=true", browser,
        )
        run("python3", "-B", "ops/host_test_data.py", env={
            **os.environ, "FOCUSPOCUS_IMAGE": tags["application"], "FOCUSPOCUS_TEST_BROWSER_IMAGE": browser,
        })
    finally:
        cleanup(record)


def main(revision):
    check_host(revision)
    state = Path("build/test-host")
    if state.is_symlink() or state.parent.is_symlink():
        raise ValueError("Test state must remain inside this checkout.")
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for record in sorted(state.glob("*.images")):
            cleanup(record)
        verify(revision, state / f"{uuid4().hex}.images", lock.fileno())
    print(f"Verified {revision} on native {platform.machine()} openSUSE Tumbleweed.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 -B ops/test-host.py FULL_COMMIT_SHA")
    try:
        main(sys.argv[1])
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
