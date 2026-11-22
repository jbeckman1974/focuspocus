"""Verify storage discovery, database separation and interrupted-run cleanup."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_host_runner import load_ops


data = load_ops("host_test_data")
network = load_ops("check-test-network")
IMAGE = "postgres:18-bookworm@sha256:" + "f" * 64


class StorageTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name).resolve()
        self.root = self.home / "containers"
        self.state = self.home / "journal"
        self.state.mkdir()
        self.mounts = []
        for sibling in ("first", "second"):
            path = self.root / sibling / "data"
            path.mkdir(parents=True)
            self.mounts.append((sibling, path))

    def test_discovers_sibling_parent_and_confirms_explicit_root(self):
        self.assertEqual(data.discover(self.mounts, home=self.home), self.root)
        self.assertEqual(data.discover(self.mounts, self.root), self.root)
        with self.assertRaises(ValueError):
            data.discover(self.mounts, self.root / "absent")
        self.assertFalse((self.root / "absent").exists())

    def test_discovers_same_parent_for_direct_and_named_bind_mounts(self):
        first, second = (path for _, path in self.mounts)
        containers = "\n".join((
            'c1\t"one"\t' + json.dumps([{"Type": "bind", "Source": str(first)}]),
            'c2\t"two"\t' + json.dumps([{"Type": "volume", "Name": "named_data"},
                                       {"Type": "volume", "Name": "regular_data"}]),
        ))
        tagged = json.dumps("named_data") + "\t" + json.dumps(str(second))
        with patch.object(data, "output", side_effect=["c1\nc2", containers, tagged]) as docker:
            sources = data.mounted_sources()
        self.assertCountEqual(sources, [("one", first), ("two", second)])
        self.assertEqual(data.discover(sources, home=self.home), self.root)
        self.assertEqual(docker.call_args.args[:4], ("docker", "volume", "inspect", "--format"))

    def test_rejects_ambiguity_same_project_and_symlink(self):
        with self.assertRaises(ValueError):
            data.discover([("same", path) for _, path in self.mounts], self.root)
        pairs = list(self.mounts)
        for i in ("one", "two"):
            path = self.home / "elsewhere" / i
            path.mkdir(parents=True)
            pairs.append((i, path))
        with self.assertRaises(ValueError):
            data.discover(pairs, home=self.home)
        alias = self.home / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            data.discover([(key, alias / path.relative_to(self.root)) for key, path in self.mounts], alias)

    def test_cleanup_keeps_existing_app_and_neighbor_data(self):
        app = self.root / "focuspocus"
        app.mkdir()
        canary = app / "existing-database"
        canary.write_text("owned by operator")
        run, record = data.allocate(self.root, self.state, IMAGE)
        self.assertEqual(run.parent, app)
        self.assertEqual(run.stat().st_mode & 0o077, 0)
        for cluster in data.CLUSTERS:
            self.assertEqual((run / cluster).stat().st_mode & 0o777, 0o711)
        self.assertEqual({p.name for p in run.iterdir()}, {"pgdata", "testdata", data.MARKER})
        data.cleanup(self.root, record, self.mounts, False)
        self.assertFalse(run.exists())
        self.assertFalse(record.exists())
        self.assertEqual(canary.read_text(), "owned by operator")

    def test_active_container_or_foreign_bind_retains_both_clusters(self):
        run, record = data.allocate(self.root, self.state, IMAGE)
        for refs, active in [(self.mounts, True), ([("backup", run / "pgdata")], False)]:
            with self.subTest(active=active), self.assertRaisesRegex(ValueError, "still references"):
                data.cleanup(self.root, record, refs, active)
            self.assertTrue((run / "pgdata").exists())
            self.assertTrue(record.exists())

    def test_replacement_symlink_blocks_all_cleanup(self):
        run, record = data.allocate(self.root, self.state, IMAGE)
        (run / "testdata").rmdir()
        (run / "testdata").symlink_to(self.root / "first", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "ownership changed"):
            data.cleanup(self.root, record, self.mounts, False)
        self.assertTrue((run / "pgdata").exists())

    def test_database_owned_files_and_interrupted_recovery(self):
        run, record = data.allocate(self.root, self.state, IMAGE)
        for name in data.CLUSTERS:
            (run / name / "fixture").touch()

        def wipe(args, check):
            mount = args[args.index("--mount") + 1]
            leaf = next(path for path in run.iterdir() if mount == f"type=bind,src={path},dst=/pgdata,bind-recursive=disabled")
            self.assertIn(leaf.name, data.CLUSTERS)
            self.assertEqual(args[args.index("--entrypoint") + 1:], ["find", IMAGE, "/pgdata", "-xdev", "-depth", "-mindepth", "1", "-delete"])
            self.assertNotIn("--privileged", args)
            if leaf.name == "testdata":
                raise RuntimeError("interrupted")
            (leaf / "fixture").unlink()

        with patch.object(data.subprocess, "run", side_effect=wipe), self.assertRaisesRegex(RuntimeError, "interrupted"):
            data.cleanup(self.root, record, self.mounts, False)
        self.assertTrue(record.is_file())
        self.assertFalse((run / "pgdata").exists())
        (run / "testdata" / "fixture").unlink()
        data.cleanup(self.root, record, self.mounts, False)
        self.assertFalse(record.exists())

    def test_resolved_sources_are_distinct_and_engine_fallback_rejected(self):
        run, _ = data.allocate(self.root, self.state, IMAGE)
        name = "focuspocus-qa-stack-abc"
        model = {
            "name": name, "networks": {"web": {"name": name + "_web"}, "database": {"name": name + "_database", "internal": True}},
            "services": {s: {"networks": {"database": {}}, "volumes": [{
                "type": "bind", "target": "/var/lib/postgresql", "source": str(run / d),
            }]} for s, d in (("db", "pgdata"), ("test-db", "testdata"))},
        }
        network.validate(model, run)
        mount = model["services"]["test-db"]["volumes"][0]
        for attr in ({"source": str(run / "pgdata")}, {"type": "volume"}):
            with patch.dict(mount, attr), self.assertRaisesRegex(ValueError, "distinct"):
                network.validate(model, run)
