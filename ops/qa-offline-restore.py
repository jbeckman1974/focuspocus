"""Run the offline browser against a native database clone after its recovery fence."""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


def output(*command):
    return subprocess.check_output(command, text=True).strip()


def main(checkpoint):
    project = os.environ.get("COMPOSE_PROJECT_NAME", "")
    if not re.fullmatch(r"focuspocus-qa-stack-[a-z0-9]+", project) or os.environ["APP_ENV"] != "development":
        raise ValueError("Restore verification requires a disposable QA stack.")
    if checkpoint.parent.parent.resolve() != (Path.cwd() / "build").resolve() or checkpoint.name != "probe-checkpoint":
        raise ValueError("Expected the generated per-run account checkpoint.")
    compose = ("docker", "compose", "-f", "compose.yaml")
    web = output(*compose, "ps", "-q", "web")
    command = json.loads(output("docker", "inspect", "--format", "{{json .Config.Cmd}}", web))
    if not isinstance(command, list) or not command:
        raise ValueError("Unable to identify the qualified web entry point.")
    name = project + "-clone"
    # Worker and web use the same application image, secrets and database role.
    # The worker service attaches solely to the internal database network.
    cid = output(*compose, "run", "--detach", "--no-deps", "--name", name,
                 "-e", "DB_HOST=test-db", "-e", "DB_NAME=restored_fixture", "worker", *command)
    try:
        details = json.loads(output("docker", "inspect", cid))[0]
        networks = details["NetworkSettings"]["Networks"]
        if set(networks) != {project + "_database"} or details["HostConfig"]["PortBindings"]:
            raise ValueError("The restored web fixture must be internal with no published ports.")
        if details["Image"] != output("docker", "inspect", "--format", "{{.Image}}", web):
            raise ValueError("The restored web process has a different application image.")
        probe = "from urllib.request import urlopen; assert urlopen('http://127.0.0.1:8000/api/v1/health/ready', timeout=2).status == 200"
        for _ in range(30):
            status = subprocess.run(["docker", "exec", cid, "python", "-c", probe],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not status.returncode:
                break
            time.sleep(1)
        else:
            raise RuntimeError("The fenced restore did not become ready.")
        env = {**os.environ, "FOCUSPOCUS_QA_RESTORE_HOST": name}
        subprocess.run(["bash", "ops/qa-browser.sh", "recovery", str(checkpoint)], env=env, check=True)
    finally:
        subprocess.run(["docker", "rm", "--force", cid], check=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
