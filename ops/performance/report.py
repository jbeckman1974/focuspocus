"""Publish only synthetic counts, browser measurements and machine characteristics."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def inspect_image(name):
    fmt = '{{.Id}} {{.Os}}/{{.Architecture}} {{with .Config.Labels}}{{index . "org.opencontainers.image.revision"}}{{end}}'
    parts = output("docker", "image", "inspect", "--format", fmt, name).split()
    return {"digest": parts[0], "platform": parts[1], "revisionLabel": parts[2] if len(parts) > 2 else None}


def service_limits(container):
    template = "{{.HostConfig.NanoCpus}}|{{.HostConfig.CpuQuota}}|{{.HostConfig.CpusetCpus}}|{{.HostConfig.Memory}}"
    nano, quota, cpuset, memory = output("docker", "inspect", "--format", template, container).split("|")
    return {"nanoCPUs": int(nano), "cpuQuota": int(quota), "cpuSet": cpuset, "memoryLimitBytes": int(memory)}


def data_storage(database):
    # Exclude Docker volume names and host paths. On Desktop, the physical disk
    # behind a VM's filesystem cannot be identified from the client container.
    fields = output("docker", "exec", database, "df", "-PkT", "/var/lib/postgresql").splitlines()[-1].split()
    return {"filesystem": fields[1], "filesystemCapacityKiB": int(fields[2]),
            "backingPhysicalDevice": "unverified"}


def main(scratch, status):
    with (scratch / "accounts.json").open() as file:
        fixture = json.load(file)["fixture"]
    try:
        browser = json.loads((scratch / "browser.json").read_text())
    except (ValueError, OSError):
        browser = {"complete": False, "measurements": {}}
    host_info = output("docker", "info", "--format", "{{.NCPU}} {{.MemTotal}} {{.Architecture}}").split()
    database = output("docker", "compose", "-f", "compose.yaml", "ps", "-q", "db")
    report = {"schema": 1, "createdUTC": datetime.now(timezone.utc).isoformat(),
              "revision": output("git", "rev-parse", "HEAD"), "hostOS": platform.system(),
              "hostKernel": platform.release(), "hostArch": platform.machine(),
              "engineCPUs": int(host_info[0]), "engineMemoryBytes": int(host_info[1]), "engineArch": host_info[2],
              "databaseStorage": data_storage(database), "webLimits": service_limits(os.environ["FOCUSPOCUS_QA_WEB_ID"]),
              "databaseLimits": service_limits(database), "app": inspect_image(os.environ["FOCUSPOCUS_IMAGE"]), "browserImage": inspect_image(os.environ["FOCUSPOCUS_TEST_BROWSER_IMAGE"]),
              "browserExitCode": status, "fixture": fixture, "browser": browser}
    directory = Path("build/performance")
    if directory.is_symlink() or directory.parent.is_symlink():
        raise ValueError("Benchmark evidence must stay under build/.")
    directory.mkdir(exist_ok=True)
    raw = (json.dumps(report, indent=2, allow_nan=False) + "\n").encode()
    # Refuse symlink destinations and replace completed files atomically.
    for name, contents in (("report.json", raw), ("SHA256SUMS", (hashlib.sha256(raw).hexdigest() + "  report.json\n").encode())):
        path = directory / name
        if path.is_symlink():
            raise ValueError("Evidence files must be local.")
        temp = scratch / name
        temp.write_bytes(contents)
        temp.replace(path)
    for name, metric in browser.get("measurements", {}).items():
        print(f"{name}: {metric['observedMs']:.1f} ms, budget {metric['budgetMs']} ms, {metric['passed']=}")
    print(f"Benchmark evidence SHA256 {hashlib.sha256(raw).hexdigest()}")
    if not browser.get("complete", False):
        sys.exit("The qualification did not complete.")


if __name__ == "__main__":
    main(Path(sys.argv[1]), int(sys.argv[2]))
