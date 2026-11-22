"""Verify a deployment through two authenticated sessions of its dedicated smoke account."""

import json
import os
import re
import stat
import sys
from uuid import UUID, uuid4

from smoke_session import ApiFailure, ProbeError, signed_in


def read_account(path, origin):
    if not re.fullmatch(r"https://[a-zA-Z0-9.-]+(?::[0-9]+)?", origin):
        raise ProbeError("Supply the exact HTTPS deployment origin.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, encoding="utf-8") as source:
        info = os.fstat(source.fileno())
        private = stat.S_IMODE(info.st_mode) in (0o400, 0o600)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or not private:
            raise ProbeError("The credential file must be owned by this operator with mode 0400 or 0600.")
        if info.st_size > 16_384:
            raise ProbeError("Invalid credential file size.")
        account = json.load(source)
    if set(account) != {"origin", "username", "password", "workspace"} or account["origin"] != origin:
        raise ProbeError("The credential file must identify this exact deployment origin.")
    if not all(isinstance(value, str) and value for value in account.values()):
        raise ProbeError("Missing credential file fields.")
    if not re.fullmatch(r"focuspocus-smoke-[a-z0-9-]{1,50}", account["username"]):
        raise ProbeError("Use a dedicated account with the focuspocus-smoke- prefix.")
    if str(UUID(account["workspace"])) != account["workspace"]:
        raise ProbeError("Supply a canonical verification workspace UUID.")
    return account


def marker(item_id):
    return "Deployment check " + item_id


def ordered_ids(snapshot, workspace):
    if snapshot["workspaceId"] != workspace or snapshot["projects"] or snapshot.get("folders") or snapshot["tags"]:
        raise ProbeError("The workspace contains other resources or its identity has changed.")
    result = []
    for task in snapshot["tasks"]:
        if task["title"] != marker(task["id"]) or task["parentId"] != "inbox" or task["kind"] != "action":
            raise ProbeError("Only an empty or dedicated synthetic workspace may be used.")
        result.append(task["id"])
    return result


def check_private(session, other_workspace):
    try:
        session.request(f"workspaces/{other_workspace}/snapshot")
    except ApiFailure as error:
        if error.status == 404:
            return
        raise
    raise ProbeError("A verification account could read the other private workspace.")


def verify_capture(origin, account, neighbor, previous=None):
    workspace = account["workspace"]
    if neighbor["workspace"] == workspace or neighbor["username"] == account["username"]:
        raise ProbeError("Use two different synthetic accounts and workspaces.")
    base = f"workspaces/{workspace}/"
    with signed_in(origin, account) as writer, signed_in(origin, account) as reader:
        with signed_in(origin, neighbor) as outsider:
            other_workspace = neighbor["workspace"]
            ordered_ids(outsider.request(f"workspaces/{other_workspace}/snapshot"), other_workspace)
            check_private(outsider, workspace)
            check_private(reader, other_workspace)
        initial = writer.request(base + "snapshot")
        original = ordered_ids(initial, workspace)
        if previous is not None and original != previous:
            raise ProbeError("The retained task identities or order changed after replacement.")
        item_id = str(uuid4())
        command = {
            "operationId": str(uuid4()),
            "expectedRevision": initial["revision"],
            "context": initial["context"],
            "payload": {"parentId": "inbox", "items": [{"id": item_id, "title": marker(item_id)}]},
        }
        accepted = writer.request(base + "commands/capture", command)
        if accepted["operationId"] != command["operationId"] or accepted["selection"] != [item_id]:
            raise ProbeError("The capture acknowledgement did not match the operation.")
        if reader.request(base + "commands/capture", command) != accepted:
            raise ProbeError("The second session did not receive the original receipt on retry.")
        final = reader.request(base + "snapshot")
        identities = ordered_ids(final, workspace)
        if identities != [*original, item_id] or final["revision"] != initial["revision"] + 1:
            raise ProbeError("The second session did not observe exactly one ordered capture.")
        return identities


def main():
    if os.environ.get("FOCUSPOCUS_SYNTHETIC_CHECK") != "1":
        raise ProbeError("Set FOCUSPOCUS_SYNTHETIC_CHECK=1 to explicitly authorize a write.")
    origin = os.environ["FOCUSPOCUS_ORIGIN"]
    account = read_account(os.environ["FOCUSPOCUS_SMOKE_FILE"], origin)
    neighbor = read_account(os.environ["FOCUSPOCUS_ISOLATION_FILE"], origin)
    verify_capture(origin, account, neighbor)
    print("Verified private-account isolation, one synthetic capture, cross-session reread and replay.")


if __name__ == "__main__":
    try:
        main()
    except ProbeError as error:
        sys.exit(str(error))
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit("The smoke configuration or API response was invalid. No credentials were logged.")
