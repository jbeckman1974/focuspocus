"""Publish only the evidence approved for the synthetic encrypted-recovery artifact."""

from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from uuid import uuid4


SIZES = ("database_bytes", "actions", "jobs", "workspaces", "attachment_bytes")
REVISION = re.compile(r"[a-f0-9]{40}")


def provenance(image_revision, environment):
    if image_revision and not REVISION.fullmatch(image_revision):
        raise ValueError("The application image has an invalid source revision label.")
    if environment.get("GITHUB_ACTIONS") != "true":
        return {"source_revision": image_revision or None, "ci_job_url": None, "ci_run_attempt": None}
    if not image_revision or image_revision != environment.get("GITHUB_SHA"):
        raise ValueError("The recovered image revision does not match the native job candidate.")
    repository = environment.get("GITHUB_REPOSITORY", "")
    run, attempt, job = (environment.get(key, "") for key in
                         ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "FOCUSPOCUS_CI_JOB_ID"))
    if (environment.get("GITHUB_SERVER_URL") != "https://github.com"
            or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)
            or not all(re.fullmatch(r"[1-9][0-9]*", value) for value in (run, attempt, job))):
        raise ValueError("The native job is missing its GitHub Actions identity.")
    return {"source_revision": image_revision, "ci_run_attempt": int(attempt),
            "ci_job_url": f"https://github.com/{repository}/actions/runs/{run}/job/{job}"}


def summary(*, architecture, image_id, revision, environment, snapshot, archive_sha256, archive_bytes, rpo, rto):
    if (architecture not in ("amd64", "arm64") or not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id)
            or not re.fullmatch(r"[a-f0-9]{64}", archive_sha256)):
        raise ValueError("Invalid recovery image, architecture or archive identity.")
    sizes = {key: snapshot[key] for key in SIZES}
    if not all(type(value) is int and value >= 0 for value in (*sizes.values(), archive_bytes)):
        raise ValueError("The synthetic fixture measurements must be counts or byte sizes.")
    if not 0 <= rpo <= 86400 or not 0 <= rto <= 14400:
        raise RuntimeError(f"QA recovery missed its objectives (RPO {rpo:.1f}s, RTO {rto:.1f}s).")
    return {
        "scope": "single-host synthetic recovery drill", "result": "passed", "arch": architecture,
        "completed_utc": datetime.now(timezone.utc).isoformat(), "image_id": image_id,
        **provenance(revision, environment),
        "rpo_upper_bound_seconds": round(rpo, 2), "validated_rto_seconds": round(rto, 2),
        "archive_sha256": archive_sha256, "archive_bytes": archive_bytes, **sizes,
        "revoked_membership_reconciled": True, "concurrent_migrators_serialized": True,
    }


@contextmanager
def evidence_directory(build):
    destination = build / "recovery"
    if build.is_symlink() or destination.is_symlink():
        raise ValueError("Recovery evidence must stay inside the checkout build directory.")
    destination.mkdir(mode=0o700, exist_ok=True)
    directory = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(directory, fcntl.LOCK_EX)
        for name in ("report.json", ".attempt"):
            path = destination / name
            try:
                mode = path.lstat().st_mode
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(mode):
                raise ValueError("Recovery evidence must use regular files inside the checkout.")
        yield destination
    finally:
        os.close(directory)


def write_json(output, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, delete=False) as temporary:
        pending = Path(temporary.name)
        try:
            json.dump(value, temporary, indent=2, sort_keys=True, allow_nan=False)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
            os.replace(pending, output)
        finally:
            pending.unlink(missing_ok=True)


def require_attempt(directory, attempt):
    marker = directory / ".attempt"
    if not re.fullmatch(r"[a-f0-9]{32}", attempt) or not marker.exists() or json.loads(marker.read_text()) != attempt:
        raise ValueError("A newer invocation owns the current recovery report.")


def begin_attempt(build, inherited=None):
    with evidence_directory(build) as directory:
        if inherited is not None:
            require_attempt(directory, inherited)
            return inherited
        output = directory / "report.json"
        if output.exists():
            previous = Path(tempfile.mkdtemp(prefix="previous-", dir=directory))
            output.rename(previous / output.name)
        attempt = uuid4().hex
        write_json(directory / ".attempt", attempt)
        return attempt


def publish(build, report, attempt):
    with evidence_directory(build) as directory:
        require_attempt(directory, attempt)
        output = directory / "report.json"
        write_json(output, {**report, "recovery_attempt": attempt})
        return output


def verify_current(build, attempt):
    with evidence_directory(build) as directory:
        require_attempt(directory, attempt)
        output = directory / "report.json"
        if not output.is_file():
            raise ValueError("This recovery attempt has no completed report.")
        report = json.loads(output.read_text())
        if report.get("recovery_attempt") != attempt or report.get("result") != "passed":
            raise ValueError("The available report does not verify this recovery attempt.")


if __name__ == "__main__":
    if sys.argv[1:] == ["begin"]:
        print(begin_attempt(Path("build"), os.getenv("FOCUSPOCUS_HOST_RECOVERY_ATTEMPT")))
    elif sys.argv[1:] == ["verify-current"]:
        verify_current(Path("build"), os.environ["FOCUSPOCUS_RECOVERY_ATTEMPT"])
    else:
        sys.exit("Usage: python3 -B ops/recovery/report.py {begin|verify-current}")
