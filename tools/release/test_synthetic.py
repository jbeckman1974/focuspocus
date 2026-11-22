import json
import os
import secrets
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from smoke_session import ApiFailure, NoRedirect, ProbeError
from synthetic_probe import main, marker, read_account, verify_capture


def account():
    return {
        "origin": "https://probe.invalid",
        "username": "focuspocus-smoke-" + secrets.token_hex(8),
        "password": secrets.token_urlsafe(32),
        "workspace": str(uuid4()),
    }


class ConfigurationTests(unittest.TestCase):
    def test_explicit_opt_in_precedes_credential_access(self):
        with patch.dict(os.environ, {}, clear=True), patch("synthetic_probe.read_account") as read:
            with self.assertRaises(ProbeError):
                main()
            read.assert_not_called()

    def test_private_owned_file_binds_origin_workspace_and_account(self):
        data = account()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "probe"
            alias = Path(folder) / "alias"
            alias.symlink_to(path)
            path.write_text(json.dumps(data))
            path.chmod(0o600)
            self.assertEqual(read_account(path, data["origin"]), data)
            with self.assertRaises(OSError):
                read_account(alias, data["origin"])
            for other in ("https://other.invalid", "http://probe.invalid", "https://probe.invalid/extra"):
                with self.assertRaises(ProbeError):
                    read_account(path, other)
            path.chmod(0o644)
            with self.assertRaises(ProbeError):
                read_account(path, data["origin"])
            path.chmod(0o600)
            data["username"] = "ordinary"
            path.write_text(json.dumps(data))
            with self.assertRaises(ProbeError):
                read_account(path, data["origin"])

    def test_redirects_never_forward_post_or_session(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 307, "", {}, "https://other.invalid"))


class ProbeJourney(unittest.TestCase):
    def setUp(self):
        self.owner, self.neighbor = account(), account()
        self.data = {self.owner["workspace"]: [], self.neighbor["workspace"]: []}
        self.sessions = []
        self.commands = []
        self.last = None
        self.leak = False
        self.shelves = {}

    @contextmanager
    def session(self, origin, identity):
        workspace = identity["workspace"]
        session = len(self.sessions)
        self.sessions.append(workspace)

        def request(path, data=None):
            workspace_id = path.split("/")[1]
            if workspace_id != workspace and not self.leak:
                raise ApiFailure(404)
            tasks = self.data[workspace_id]
            if data is None and "/shelf?state=" in path:
                return {"items": self.shelves.get((workspace_id, path.split("=")[-1]), [])}
            if data is None:
                return {"workspaceId": workspace_id, "projects": [], "folders": [], "tags": [], "tasks": list(tasks),
                        "revision": len(tasks), "context": str(uuid4())}
            self.commands.append((session, data))
            if self.last and self.last["operationId"] == data["operationId"]:
                return self.last
            entry = data["payload"]["items"][0]
            tasks.append({**entry, "parentId": "inbox", "kind": "action"})
            self.last = {"operationId": data["operationId"], "selection": [entry["id"]]}
            return self.last

        class Session:
            pass

        client = Session()
        client.request = request
        yield client

    def verify(self, previous=None):
        with patch("synthetic_probe.signed_in", self.session):
            return verify_capture(self.owner["origin"], self.owner, self.neighbor, previous)

    def test_three_scoped_sessions_and_same_operation_replay(self):
        result = self.verify(previous=[])
        self.assertEqual(self.sessions, [self.owner["workspace"], self.owner["workspace"], self.neighbor["workspace"]])
        self.assertEqual(len(result), 1)
        self.assertEqual(self.commands[0][1], self.commands[1][1])
        self.assertNotEqual(self.commands[0][0], self.commands[1][0])

    def test_isolation_or_unexpected_content_failure_prevents_all_writes(self):
        self.leak = True
        with self.assertRaises(ProbeError):
            self.verify()
        self.leak = False
        self.data[self.owner["workspace"]].append({"id": str(uuid4()), "title": "User's task"})
        with self.assertRaises(ProbeError):
            self.verify()
        self.assertFalse(self.commands)

    def test_archived_or_trashed_items_in_either_workspace_prevent_writes(self):
        for account in (self.owner, self.neighbor):
            for shelf in ("archive", "trash"):
                self.shelves = {(account["workspace"], shelf): [{"id": str(uuid4())}]}
                with self.assertRaises(ProbeError):
                    self.verify()
                self.assertEqual(self.commands, [])

    def test_refuses_wrong_replacement_order_before_mutation(self):
        ids = [str(uuid4()), str(uuid4())]
        self.data[self.owner["workspace"]] = [
            {"id": item, "title": marker(item), "kind": "action", "parentId": "inbox"} for item in ids
        ]
        with self.assertRaises(ProbeError):
            self.verify(previous=list(reversed(ids)))
        self.assertFalse(self.commands)


if __name__ == "__main__":
    unittest.main()
