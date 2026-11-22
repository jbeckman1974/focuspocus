"""Validate the resolved disposable Compose model before starting containers."""

import json
import os
from pathlib import Path
import re
import sys


def validate(config, data_dir=None):
    project = config["name"]
    if not re.fullmatch(r"focuspocus-qa-stack-[a-z0-9]+", project):
        raise ValueError("Unexpected QA project name.")
    networks = config["networks"]
    if set(networks) != {"database", "web"} or not networks["database"].get("internal"):
        raise ValueError("The QA stack requires its own web and internal database networks.")
    for key, network in networks.items():
        if network.get("external") or network.get("name") != f"{project}_{key}":
            raise ValueError("QA networks must belong to this Compose project.")
    for key, volume in config.get("volumes", {}).items():
        if volume.get("external") or volume.get("name") != f"{project}_{key}":
            raise ValueError("QA volumes must belong to this Compose project.")
    for name, service in config["services"].items():
        if service.get("network_mode") or not service.get("networks") or set(service["networks"]) - networks.keys():
            raise ValueError("Unexpected QA service network.")
        ports = service.get("ports", [])
        if name == "web":
            if len(ports) == 1 and ports[0].get("host_ip") == "127.0.0.1" and ports[0]["target"] == 8000:
                continue
            raise ValueError("The QA web service must publish its one port on loopback.")
        if ports:
            raise ValueError("Only the QA web service may publish a port.")
    if data_dir:
        for service, directory in (("db", "pgdata"), ("test-db", "testdata")):
            expected = Path(data_dir) / directory
            mounts = [v for v in config["services"][service]["volumes"] if v["target"] == "/var/lib/postgresql"]
            if len(mounts) != 1 or mounts[0]["type"] != "bind" or mounts[0]["source"] != str(expected):
                raise ValueError("The test databases must bind their distinct run-owned directories.")


if __name__ == "__main__":
    try:
        validate(json.load(sys.stdin), os.getenv("FOCUSPOCUS_TEST_DATA_DIR"))
    except (KeyError, TypeError, ValueError) as error:
        sys.exit(str(error))
