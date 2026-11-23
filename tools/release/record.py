"""Print the immutable registry identity of the already-tested native image."""

import json
import os
import sys

from publish import docker, inspect_digest
from provenance import RUN_ATTEMPT, RUN_NUMBER, build_order


def record(candidate, local):
    config = json.loads(docker("image", "inspect", local))[0]
    digest = inspect_digest(candidate)
    immutable = candidate.rsplit(":", 1)[0] + "@" + digest
    manifest = json.loads(docker("buildx", "imagetools", "inspect", "--raw", immutable))
    if manifest["config"]["digest"] != config["Id"]:
        raise ValueError("Staged image does not match tested image")
    labels = config["Config"]["Labels"]
    version = labels.get("org.opencontainers.image.version")
    commit = labels.get("org.opencontainers.image.revision")
    number, attempt = labels.get(RUN_NUMBER), labels.get(RUN_ATTEMPT)
    if ((version, commit) != (os.environ["VERSION"], os.environ["GITHUB_SHA"])
            or build_order(number, attempt) != build_order(os.environ["GITHUB_RUN_NUMBER"], os.environ["GITHUB_RUN_ATTEMPT"])):
        raise ValueError("Native image labels differ from the qualifying workflow")
    return {"commit": commit, "version": version, "run_number": number, "run_attempt": attempt,
            "platform": config["Os"] + "/" + config["Architecture"],
            "id": config["Id"], "digest": digest}


if __name__ == "__main__":
    print(json.dumps(record(*sys.argv[1:])))
