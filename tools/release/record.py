"""Print the immutable registry identity of the already-tested native image."""

import json
import os
import sys

from publish import docker, inspect_digest


def record(candidate, local):
    config = json.loads(docker("image", "inspect", local))[0]
    digest = inspect_digest(candidate)
    immutable = candidate.rsplit(":", 1)[0] + "@" + digest
    manifest = json.loads(docker("buildx", "imagetools", "inspect", "--raw", immutable))
    if manifest["config"]["digest"] != config["Id"]:
        raise ValueError("Staged image does not match tested image")
    return {"commit": os.environ["GITHUB_SHA"], "platform": config["Os"] + "/" + config["Architecture"],
            "id": config["Id"], "digest": digest}


if __name__ == "__main__":
    print(json.dumps(record(*sys.argv[1:])))
