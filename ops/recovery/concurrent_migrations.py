"""Prove two deployed migration commands serialize on a disposable database with pending work."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import subprocess
import time


DATABASE = "contended_fixture"
BASELINE_DATABASE = "prior_release_fixture"
BASE_MIGRATION = "0021_membership_incarnations"
HOLDER = "focuspocus-qa-ledger-holder"
LEDGER = "SELECT app || ':' || name FROM django_migrations ORDER BY app, name"
SAVED_ITEM = "SELECT id, workspace_id, title, position, version, flagged FROM core_item ORDER BY id"


def sql(stack, database, query):
    return stack.run("exec", "-T", "test-db", "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                     "-d", database, "-c", query, capture_output=True, text=True, timeout=15).stdout.strip()


def wait_for(stack, condition, description, processes=()):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if sql(stack, DATABASE, condition) == "t":
            return
        for process in processes:
            if process.done():
                process.result()  # Surface an actual migrator failure.
                raise RuntimeError("A migration finished before its contention was observed.")
        time.sleep(0.2)
    raise RuntimeError("PostgreSQL did not observe " + description + ".")


@contextmanager
def hold_ledger(stack):
    # The independent transaction holds only the ledger table. Both advisory-lock participants are real migrators.
    args = [*stack.compose, "exec", "-T", "-e", f"PGAPPNAME={HOLDER}", "test-db", "psql", "-XqAt",
            "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE]
    with subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True) as holder:
        try:
            holder.stdin.write("BEGIN;\nLOCK TABLE django_migrations IN ACCESS EXCLUSIVE MODE;\n")
            holder.stdin.flush()
            wait_for(stack, f"""
                SELECT EXISTS (
                    SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid)
                    WHERE a.datname = current_database() AND a.application_name = '{HOLDER}'
                      AND l.relation = 'django_migrations'::regclass AND l.mode = 'AccessExclusiveLock' AND l.granted)
            """, "the independent ledger hold")
            yield
        finally:
            # EOF ends the session and rolls back the hold, also on a failed observation.
            try:
                holder.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                holder.kill()
                holder.wait()
                raise
        if holder.returncode:
            raise RuntimeError("The independent ledger hold failed.")


CONTENTION = f"""
    WITH schema_locks AS (
        SELECT a.pid, l.granted FROM pg_locks l JOIN pg_stat_activity a USING (pid)
        WHERE a.datname = current_database() AND a.usename = 'fpmigrate'
          AND l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND l.objsubid = 1
          AND l.classid::bigint = ((hashtext('focuspocus-schema')::bigint >> 32) & 4294967295)
          AND l.objid::bigint = (hashtext('focuspocus-schema')::bigint & 4294967295)
    )
    SELECT (SELECT count(*) FROM schema_locks) = 2 AND EXISTS (
        SELECT 1 FROM schema_locks owner, schema_locks waiter, pg_stat_activity holder
        WHERE owner.granted AND NOT waiter.granted
          AND holder.datname = current_database() AND holder.application_name = '{HOLDER}'
          AND owner.pid = ANY(pg_blocking_pids(waiter.pid))
          AND holder.pid = ANY(pg_blocking_pids(owner.pid)))
"""


def verify(stack, reference_database):
    stack.create_database(BASELINE_DATABASE)
    stack.bootstrap_roles(BASELINE_DATABASE)
    stack.run(*stack.app_args("migrate", BASELINE_DATABASE), "python", "/qa-recovery/fixture.py", "migration-baseline")
    item = sql(stack, BASELINE_DATABASE, SAVED_ITEM)
    stack.create_database(DATABASE, template=BASELINE_DATABASE)
    stack.bootstrap_roles(DATABASE)
    migrate = stack.app_args("migrate", DATABASE)
    prior = sql(stack, DATABASE, LEDGER).splitlines()
    reference = sql(stack, reference_database, LEDGER).splitlines()
    if (not item or sql(stack, DATABASE, SAVED_ITEM) != item or f"core:{BASE_MIGRATION}" not in prior
            or not any(entry.startswith("core:") and entry not in prior for entry in reference)):
        raise RuntimeError("The contender clone requires a saved task and pending application migrations.")
    with ThreadPoolExecutor(max_workers=2) as pool:
        with hold_ledger(stack):
            processes = [pool.submit(stack.run, *migrate, stdout=subprocess.DEVNULL, timeout=180) for _ in range(2)]
            wait_for(stack, CONTENTION, "one migration owner and its blocked peer", processes)
        for process in processes:
            process.result()
    actual = sql(stack, DATABASE, LEDGER).splitlines()
    if actual != reference or len(actual) != len(set(actual)):
        raise RuntimeError("The contended migration ledger differs from a single-owner release upgrade.")
    if sql(stack, DATABASE, SAVED_ITEM) != item:
        raise RuntimeError("The contended upgrade changed the saved task.")
    stack.run(*migrate, "python", "manage.py", "migrate", "--check")
