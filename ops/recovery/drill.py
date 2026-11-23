"""Rehearse migration failure and authenticated recovery in verify-stack's generated project."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from envelope import openssl, seal, unseal
import concurrent_migrations
import report


ROOT = Path.cwd()
QA = ROOT / "ops/recovery"
FAILED = "failed_fixture"
CLEAN = "restored_fixture"


class Stack:
    def __init__(self, scratch):
        project = os.environ.get("COMPOSE_PROJECT_NAME", "")
        if (not re.fullmatch(r"focuspocus-qa-stack-[a-z0-9]+", project)
                or os.environ.get("APP_ENV") != "development"
                or scratch.parent != ROOT / "build" or scratch.is_symlink()
                or not scratch.name.startswith("qa-stack.") or scratch.stat().st_mode & 0o077
                or Path(os.environ["FOCUSPOCUS_SECRET_DIR"]) != scratch / "secrets"):
            raise ValueError("Use the private project created by ops/verify-stack.sh.")
        self.compose = ["docker", "compose", "-f", "compose.yaml", "-f", "ops/compose.tests.yaml", "--profile", "testing"]
        if os.environ.get("FOCUSPOCUS_TEST_DATA_DIR"):
            self.compose.extend(["-f", "ops/compose.host-test.yaml"])

    def run(self, *args, **kwargs):
        return subprocess.run([*self.compose, *args], check=True, **kwargs)

    def app_args(self, service, database, *, candidate=None):
        server = "db" if database == "focuspocus" else "test-db"
        args = ["run", "-T", "--rm", "--no-deps", "-v", f"{QA}:/qa-recovery:ro",
                "-e", "PYTHONPATH=/srv/app:/qa-recovery", "-e", f"DB_HOST={server}", "-e", f"DB_NAME={database}"]
        if candidate:
            args.extend(["-e", "DJANGO_SETTINGS_MODULE=candidate_settings", "-e", f"FOCUSPOCUS_QA_BASE_MIGRATION={candidate}"])
        return [*args, service]

    def fixture(self, phase, database="focuspocus", *, candidate=None, stdin=None):
        args = self.app_args("worker", database, candidate=candidate)
        return self.run(*args, "python", "/qa-recovery/fixture.py", phase, stdin=stdin,
                        stdout=subprocess.PIPE, text=True).stdout.strip()

    def digest(self, database):
        with Path("ops/check-database.py").open() as checks:
            return self.run(*self.app_args("worker", database), "python", "-", stdin=checks,
                            stdout=subprocess.PIPE, text=True).stdout.strip()

    def create_database(self, database, *, template=None):
        # createdb must succeed exclusively. Never empty, drop or reuse an existing database.
        source = ["--template", template] if template else []
        self.run("exec", "-T", "test-db", "createdb", "-U", "postgres", "-O", "fpmigrate", *source, database)

    def bootstrap_roles(self, database):
        self.run("exec", "-T", "-e", f"POSTGRES_DB={database}", "test-db", "sh", "/docker-entrypoint-initdb.d/10-roles.sh")

    def restore(self, database, archive):
        self.create_database(database)
        with archive.open("rb") as data:
            self.run("exec", "-T", "test-db", "pg_restore", "-U", "fpmigrate", "--single-transaction",
                     "--exit-on-error", "--no-owner", "--no-acl", "-d", database, stdin=data)
        self.bootstrap_roles(database)
        self.run(*self.app_args("migrate", database))

    def recovered_worker(self):
        # Start only after reconciliation, using the worker's internal-only network.
        cid = self.run("run", "--detach", "--no-deps", "-e", "DB_HOST=test-db", "-e", f"DB_NAME={CLEAN}",
                       "worker", capture_output=True, text=True).stdout.strip()
        try:
            with Path("ops/check-worker.py").open() as probe:
                subprocess.run(["docker", "exec", "-i", cid, "python", "-"], stdin=probe, check=True)
            subprocess.run(["docker", "exec", cid, "python", "manage.py", "worker_health"], check=True)
        finally:
            subprocess.run(["docker", "rm", "--force", cid], check=True)

    def fail_migration(self):
        current_head = self.fixture("release_head", FAILED)
        args = [*self.compose, *self.app_args("migrate", FAILED, candidate=current_head)]
        failed = subprocess.run(args, capture_output=True, text=True)
        if failed.returncode != 1 or "intentional QA migration failure" not in failed.stderr:
            raise RuntimeError("The injected migration did not reach its intended SQL error.")
        sql = """
            SELECT (SELECT array_agg(step ORDER BY step) FROM qa_migration_marker) = ARRAY[1]
               AND (SELECT count(*) FROM django_migrations WHERE app='core' AND name='9001_qa_marker') = 1
               AND NOT EXISTS (SELECT 1 FROM django_migrations WHERE app='core' AND name='9002_qa_failure')
               AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qa_migration_marker'
                               AND column_name='uncommitted')
        """
        actual = self.run("exec", "-T", "test-db", "psql", "-XAt", "-U", "postgres", "-d", FAILED,
                          "-v", "ON_ERROR_STOP=1", "-c", sql, capture_output=True, text=True).stdout.strip()
        if actual != "t":
            raise RuntimeError("Partial migration ledger, row or column differed from the expected transaction boundary.")
        # Both the failed release and the previous image must decline the partial core schema.
        self.fixture("unready", FAILED, candidate=current_head)
        self.fixture("unready", FAILED)


def generate_recipient(cert, key):
    subprocess.run(openssl(
        "req", "-x509", "-newkey", "rsa:3072", "-noenc", "-batch", "-subj", "/CN=Disposable recovery drill",
        "-days", "1", "-keyout", key, "-out", cert,
    ), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run(scratch):
    os.umask(0o077)
    stack = Stack(scratch)
    recovery = scratch / "recovery"
    recovery.mkdir(mode=0o700)
    custody = recovery / "key-custody"
    staging = recovery / "retrieved-copy"
    custody.mkdir()
    staging.mkdir()
    key, cert = custody / "key.pem", recovery / "recipient.crt"
    generate_recipient(cert, key)
    # Sources are synthetic. Stop worker writes while measuring the consistent point.
    stack.run("stop", "worker")
    with Path("ops/performance/seed.py").open() as seed:
        stack.run("exec", "-T", "web", "python", "-", stdin=seed, stdout=subprocess.DEVNULL)
    grant_record = recovery / "shared-grant.json"
    grant_record.write_text(stack.fixture("grant-prepare"))
    last_included = time.monotonic()
    stack.fixture("seed")
    saved = stack.digest("focuspocus")
    before = json.loads(stack.fixture("snapshot"))
    if before["actions"] < 10000 or before["attachment_bytes"] < 4 * 1024 * 1024:
        raise RuntimeError("Recovery fixture lacks the representative workload.")
    original = recovery / "backup.cms"
    digest = seal(cert, original, [*stack.compose, "exec", "-T", "db", "pg_dump", "-U", "postgres",
                                   "--format=custom", "focuspocus"])
    stack.fixture("later")
    # Only an access decision verified on the post-cut source goes into the independent grant log.
    with grant_record.open() as grant:
        revoked = stack.fixture("grant-revoke", stdin=grant)
    grant_log = recovery / "post-cut-revocations.json"
    grant_log.write_text(revoked)
    retrieved = staging / original.name
    shutil.copyfile(original, retrieved)
    original.unlink()
    clear = recovery / "verified.dump"
    unseal(cert, key, retrieved, digest, clear)
    with clear.open("rb") as data:
        stack.run("exec", "-T", "test-db", "pg_restore", "--list", stdin=data, stdout=subprocess.DEVNULL)
    stack.restore(FAILED, clear)
    clear.unlink()

    loss = time.monotonic()
    stack.fail_migration()
    stack.fixture("source")
    # Retrieve and authenticate anew after service loss. The failed volume stays available for diagnosis.
    unseal(cert, key, retrieved, digest, clear)
    stack.restore(CLEAN, clear)
    clear.unlink()
    restored = json.loads(stack.fixture("restored", CLEAN))
    if any(restored[k] != before[k] for k in before if k != "database_bytes") or stack.digest(CLEAN) != saved:
        raise RuntimeError("Restored private data, grants, attachment bodies or job state changed.")
    stack.run(*stack.app_args("worker", CLEAN), "python", "manage.py", "fence_restored_database")
    if stack.fixture("fenced", CLEAN) != before["immutable"] or stack.digest(CLEAN) != saved:
        raise RuntimeError("The recovery fence changed account, history or saved workspace data.")
    with grant_log.open() as decision:
        stack.fixture("grant-reconcile", CLEAN, stdin=decision)
    checkpoint = scratch / "probe-checkpoint"
    with checkpoint.open() as accounts:
        stack.fixture("isolation", CLEAN, stdin=accounts)
    stack.recovered_worker()
    subprocess.run([sys.executable, "-B", "ops/qa-offline-restore.py", str(checkpoint)], check=True)
    rpo, rto = loss - last_included, time.monotonic() - loss
    concurrent_migrations.verify(stack, CLEAN)
    image = stack.run("ps", "-q", "web", capture_output=True, text=True).stdout.strip()
    image_id = subprocess.check_output(["docker", "inspect", "--format", "{{.Image}}", image], text=True).strip()
    revision = subprocess.check_output([
        "docker", "image", "inspect", "--format", '{{with .Config.Labels}}{{index . "org.opencontainers.image.revision"}}{{end}}',
        image_id,
    ], text=True).strip()
    evidence = report.summary(architecture=os.environ["EXPECTED_ARCH"], image_id=image_id, revision=revision,
                              environment=os.environ, snapshot=before, archive_sha256=digest,
                              archive_bytes=retrieved.stat().st_size, rpo=rpo, rto=rto)
    report.publish(ROOT / "build", evidence)
    print("Recovery evidence " + json.dumps(evidence, sort_keys=True), flush=True)


if __name__ == "__main__":
    run(Path(sys.argv[1]))
