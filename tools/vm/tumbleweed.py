#!/usr/bin/env python3
"""Manage this checkout's disposable x86_64 Tumbleweed VM."""

import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from cloud_image import verified_image
import ownership


SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[1]
INSTANCE = "tw"
MIN_LIMA = (2, 3, 0)


def prerequisites() -> None:
    required = ("limactl", "qemu-system-x86_64", "qemu-img", "curl", "gpg", "ssh", "ssh-keygen")
    missing = [command for command in required if not shutil.which(command)]
    if missing:
        raise ValueError("Required host tools missing from PATH: " + ", ".join(missing))
    # curl 8.4 enforces --max-filesize while reading streams without Content-Length.
    for command, minimum in (("limactl", MIN_LIMA), ("curl", (8, 4, 0))):
        version = subprocess.check_output([command, "--version"], text=True).splitlines()[0]
        match = re.search(r"\bv?(\d+)\.(\d+)\.(\d+)\b", version)
        if not match or tuple(map(int, match.groups())) < minimum:
            required = ".".join(map(str, minimum))
            raise ValueError(f"{command} {required} or later is required. Found {version!r}.")
        print(version, flush=True)


def private_directory(directory: Path) -> None:
    if directory.is_symlink():
        raise ValueError(f"Unexpected symbolic link at {directory}")
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.stat().st_uid != os.getuid():
        raise ValueError(f"Expected a directory owned by the current user at {directory}")
    directory.chmod(0o700)


def template(image: Path, digest: str, instance_id: str) -> str:
    source = (SOURCE / "tumbleweed.yaml.in").read_text(encoding="utf-8")
    source = source.replace("__SHA256__", digest).replace("__INSTANCE_ID__", instance_id)
    return source.replace("__LOCAL_IMAGE__", json.dumps(str(image)))


def record_verification(state: Path, output: str) -> None:
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report = f"Verified {checked_at} on host {os.uname().sysname} {os.uname().machine}\n" + output
    with tempfile.NamedTemporaryFile(mode="w", dir=state, encoding="utf-8", delete=False) as staging:
        partial = Path(staging.name)
        try:
            staging.write(report)
            staging.flush()
            partial.replace(state / "last-verification.txt")
        finally:
            partial.unlink(missing_ok=True)
    print(report, end="")


def manage(action: str, root: Path) -> None:
    if action in {"up", "doctor"}:
        prerequisites()
    if action == "doctor":
        return

    build = root / "build"
    state = build / "vm"
    lima_home = state / "lima"
    instance = lima_home / INSTANCE
    for directory in (build, state, lima_home, instance):
        if directory.is_symlink():
            raise ValueError(f"Unexpected symbolic link at {directory}")
    if action != "up" and not state.exists():
        if action in {"verify", "shell"}:
            raise ValueError("VM is absent. Run up to create it.")
        print("VM is absent.")
        return

    build.mkdir(exist_ok=True)
    private_directory(state)
    private_directory(lima_home)
    cache = state / "images"
    private_directory(cache)
    scratch = state / "tmp"
    private_directory(scratch)
    # Pass only the host variables the toolchain needs. The guest receives no host environment.
    pass_through = ("PATH", "HOME", "USER", "LOGNAME", "TERM", "LANG")
    env = {name: os.environ[name] for name in pass_through if name in os.environ}
    env.update(LIMA_HOME=str(lima_home), TMPDIR=str(scratch))

    def lima(*args: str, stdin=None, capture=False):
        stdout = subprocess.PIPE if capture else None
        return subprocess.run(["limactl", *args], input=stdin, text=True, stdout=stdout, env=env, check=True)

    def guest(mode: str) -> None:
        result = lima(
            "shell", "--workdir=/", "--start=false", INSTANCE, "sudo", "-n", "sh", "-s", "--", mode,
            stdin=(SOURCE / "guest.sh").read_text(encoding="utf-8"), capture=(mode == "verify"),
        )
        if mode == "verify":
            record_verification(state, result.stdout)

    if action == "shell":
        if not instance.exists():
            raise ValueError("VM is absent. Run up to create it.")
        ownership.require_owned(state, instance)
        lima("shell", "--workdir=/", "--start=false", INSTANCE)
        return

    # Serialize changes, including create and the first package install. An interactive shell
    # does not own this lock, so stop can still complete from another terminal.
    fd = os.open(state / "lifecycle.lock", os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if action == "up" and not instance.exists():
            image, digest = verified_image(cache)
            instance_id = ownership.reserve(state)
            config = template(image, digest, instance_id)
            lima("create", "--tty=false", "--name=" + INSTANCE, "-", stdin=config)

        if not instance.exists():
            if action == "verify":
                raise ValueError("VM is absent. Run up to create it.")
            if action == "destroy":
                ownership.forget(state)
            print("VM is absent.")
            return
        ownership.require_owned(state, instance)
        current = lima("list", "--format={{.Status}}", INSTANCE, capture=True).stdout.strip()
        if action == "status":
            print(current)
        elif action == "destroy":
            if current == "Running":
                lima("stop", INSTANCE)
            lima("delete", "--tty=false", INSTANCE)
            ownership.forget(state)
        elif action == "stop":
            if current != "Stopped":
                lima("stop", INSTANCE)
        elif action == "verify":
            guest("verify")
        elif action == "up":
            if current == "Stopped":
                lima("start", "--tty=false", "--timeout=30m", INSTANCE)
            elif current != "Running":
                raise ValueError(f"Lima reports {current!r} for {INSTANCE}. Inspect its logs in {instance}.")
            guest("setup")
            guest("verify")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("doctor", "up", "verify", "shell", "status", "stop", "destroy"))
    os.umask(0o077)
    try:
        manage(parser.parse_args().action, ROOT)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
