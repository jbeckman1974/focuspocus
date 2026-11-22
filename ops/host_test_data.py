"""Run the test stack on verified sibling bind storage and reclaim its own two databases."""

import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4


CLUSTERS = ("pgdata", "testdata")
MARKER = ".focuspocus-run"
POSTGRES = re.compile(r"(?:docker\.io/)?(?:library/)?postgres:[\w.-]+@sha256:[a-f0-9]{64}")


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def real_directory(path):
    return path.is_absolute() and path.is_dir() and path.resolve(strict=True) == path


def mounted_sources():
    """Read only container identity, Compose ownership and bind mount paths."""
    containers = output("docker", "ps", "--all", "--quiet").split()
    if not containers:
        return []
    fmt = '{{.Id}}\t{{with .Config.Labels}}{{json (index . "com.docker.compose.project")}}{{else}}null{{end}}\t{{json .Mounts}}'
    result = []
    volume_owners = {}
    for line in output("docker", "inspect", "--format", fmt, *containers).splitlines():
        identity, encoded_owner, mounts = line.split("\t", 2)
        owner = json.loads(encoded_owner)
        for mount in json.loads(mounts) or []:
            if mount["Type"] == "bind":
                result.append((owner or identity, Path(mount["Source"])))
            elif mount["Type"] == "volume" and mount.get("Name"):
                volume_owners.setdefault(mount["Name"], set()).add(owner or identity)
    # Compose also supports named local volumes backed by a host bind. Extract
    # only their device path; other drivers' options may contain credentials.
    if volume_owners:
        template = (
            '{{if eq .Driver "local"}}{{with .Options}}{{if .device}}{{with .o}}{{range split . ","}}'
            '{{if or (eq . "bind") (eq . "rbind")}}{{json $.Name}}{{printf "\\t"}}'
            '{{json $.Options.device}}{{end}}{{end}}{{end}}{{end}}{{end}}{{end}}'
        )
        volumes = output("docker", "volume", "inspect", "--format", template, *volume_owners)
        for line in volumes.splitlines():
            if line:
                name, device = (json.loads(field) for field in line.split("\t"))
                path = Path(device)
                if path.is_absolute():
                    result.extend((owner, path) for owner in volume_owners[name])
    return result


def discover(mounts, explicit=None, home=None):
    home = home or Path.home()
    candidates = {}
    for owner, source in mounts:
        if owner.startswith("focuspocus-qa-stack-") or not real_directory(source):
            continue
        parents = [explicit] if explicit else [
            p for p in source.parents
            if (p.is_relative_to(home) and p != home) or p.name.lower() in {"docker", "containers", "appdata"}
        ]
        for parent in parents:
            if not source.is_relative_to(parent) or source == parent:
                continue
            child = source.relative_to(parent).parts[0]
            if child != "focuspocus":
                candidates.setdefault(parent, set()).add((child, owner))
    roots = [parent for parent, evidence in candidates.items() if real_directory(parent) and any(
        child != other_child and owner != other_owner
        for child, owner in evidence for other_child, other_owner in evidence
    )]
    if len(roots) != 1:
        raise ValueError("Could not identify one data parent from two sibling containers. Set FOCUSPOCUS_TEST_DATA_PARENT to the existing corroborated parent.")
    root = roots[0]
    if root == Path("/") or root == home or any(ch in str(root) for ch in ',\r\n"'):
        raise ValueError("The selected data parent cannot safely be used as a dedicated bind path.")
    return root


def identity(path):
    info = path.lstat()
    return [info.st_dev, info.st_ino]


def save(record, claim):
    pending = record.with_suffix(".pending")
    with pending.open("x") as target:
        json.dump(claim, target)
        target.flush()
        os.fsync(target.fileno())
    pending.replace(record)


def allocate(parent, state, image):
    if not POSTGRES.fullmatch(image):
        raise ValueError("The cleanup helper requires the project's digest-pinned PostgreSQL image.")
    app = parent / "focuspocus"
    app.mkdir(mode=0o700, exist_ok=True)
    if not real_directory(app):
        raise ValueError("The FocusPocus data directory must be a real directory.")
    name = "qa-" + uuid4().hex
    directory = app / name
    nonce = uuid4().hex
    record = state / (name + ".json")
    if directory.exists() or directory.is_symlink() or record.exists():
        raise ValueError("Proposed run namespace already exists.")
    claim = {"nonce": nonce, "image": image, "app": identity(app)}
    save(record, claim)
    directory.mkdir(mode=0o700)
    (directory / MARKER).write_text(nonce)
    for cluster in CLUSTERS:
        leaf = directory / cluster
        leaf.mkdir(mode=0o700)
        # postgres:18 starts as root and runs the database as its own UID in
        # the versioned subdirectory. Let that UID traverse the mount root.
        # The enclosing host run directory remains private to its owner.
        leaf.chmod(0o711)
    claim.update(run=identity(directory), clusters={c: identity(directory / c) for c in CLUSTERS})
    save(record, claim)
    return directory, record


def cleanup(parent, record, mounts, compose_active):
    if record.is_symlink() or not re.fullmatch(r"qa-[a-f0-9]{32}", record.stem):
        raise ValueError("Unrecognized host test record.")
    claim = json.loads(record.read_text())
    if not POSTGRES.fullmatch(claim["image"]):
        raise ValueError("The recorded data cleanup image is invalid.")
    app = parent / "focuspocus"
    directory = app / record.stem
    if not real_directory(app) or identity(app) != claim["app"]:
        raise ValueError("Recorded application data parent changed. Preserving run data.")
    if compose_active or any(source.is_relative_to(directory) or directory.is_relative_to(source) for _, source in mounts):
        raise ValueError("A container still references the test data. The next run will retry cleanup.")
    if not directory.exists() and not directory.is_symlink():
        record.unlink()
        return
    if not real_directory(directory) or ("run" in claim and identity(directory) != claim["run"]):
        raise ValueError("Recorded test data directory changed. Preserving run data.")
    marker = directory / MARKER
    if "run" in claim and not any(directory.iterdir()):
        directory.rmdir()
        record.unlink()
        return
    if marker.is_symlink() or not marker.is_file() or marker.read_text() != claim["nonce"]:
        raise ValueError("Test data ownership marker changed.")
    if {p.name for p in directory.iterdir()} - {*CLUSTERS, MARKER}:
        raise ValueError("The test data directory contains unrecognized entries.")
    leaves = []
    for cluster in CLUSTERS:
        leaf = directory / cluster
        if not leaf.exists() and not leaf.is_symlink():
            continue  # An interrupted cleanup may already have removed the first cluster.
        if not real_directory(leaf) or ("run" in claim and identity(leaf) != claim["clusters"][cluster]):
            raise ValueError("Cluster directory ownership changed.")
        leaves.append(leaf)
    for leaf in leaves:
        try:
            leaf.rmdir()
        except OSError:
            if "run" not in claim:
                raise ValueError("A partially provisioned cluster contains unexpected data.")
            # Docker's database UID owns these files. Expose only this verified leaf to the helper.
            subprocess.run([
                "docker", "run", "--pull=never", "--rm", "--read-only", "--network", "none", "--tmpfs", "/var/lib/postgresql",
                "--security-opt=no-new-privileges", "--cap-drop=ALL", "--cap-add=DAC_OVERRIDE", "--cap-add=FOWNER",
                "--user", "0", "--mount", f"type=bind,src={leaf},dst=/pgdata,bind-recursive=disabled",
                "--entrypoint", "find", claim["image"], "/pgdata", "-xdev", "-depth", "-mindepth", "1", "-delete",
            ], check=True)
            leaf.rmdir()
    marker.unlink()
    directory.rmdir()
    record.unlink()


def reclaim(parent, record):
    project = "focuspocus-qa-stack-" + record.stem.removeprefix("qa-")
    active = output("docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={project}")
    cleanup(parent, record, mounted_sources(), active)


def main():
    explicit = os.getenv("FOCUSPOCUS_TEST_DATA_PARENT")
    parent = discover(mounted_sources(), Path(explicit) if explicit else None)
    state = Path("build/host-data")
    if state.is_symlink() or state.parent.is_symlink():
        raise ValueError("The test ownership journal must be local to the checkout.")
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for previous in sorted(state.glob("qa-*.json")):
            reclaim(parent, previous)
        image = output("docker", "compose", "-f", "compose.yaml", "config", "--images", "db")
        directory, record = allocate(parent, state, image)
        try:
            subprocess.run(["bash", "ops/verify-stack.sh"], check=True, pass_fds=(lock.fileno(),),
                           env={**os.environ, "FOCUSPOCUS_TEST_DATA_DIR": str(directory)})
        finally:
            reclaim(parent, record)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
