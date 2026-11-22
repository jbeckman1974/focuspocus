"""Bounded leasing and scoped execution for the SQL worker."""

import socket
import uuid
from datetime import timedelta

from django.db import OperationalError, transaction
from django.db.models import Q
from django.utils import timezone

from core.access import locked_membership
from core.models import Job, Membership, WorkerHeartbeat


MAX_ATTEMPTS = 4
LEASE = timedelta(seconds=30)
MAX_HEARTBEAT_AGE = timedelta(seconds=45)
PROBE = "workspace-revision-probe"


def heartbeat():
    WorkerHeartbeat.objects.update_or_create(
        name=socket.gethostname(), defaults={"updated_at": timezone.now()}
    )


def heartbeat_fresh():
    return WorkerHeartbeat.objects.filter(
        name=socket.gethostname(), updated_at__gte=timezone.now() - MAX_HEARTBEAT_AGE
    ).exists()


@transaction.atomic
def enqueue_probe(actor, workspace_id, key):
    workspace, _ = locked_membership(actor, workspace_id)
    if workspace is None or not actor.is_active:
        raise ValueError("Unknown authorized actor/workspace pair")
    return Job.objects.get_or_create(
        workspace=workspace,
        dedupe_key=f"probe:{actor.pk}:{key}",
        defaults={"actor": actor, "kind": PROBE, "payload": {"revision": workspace.revision}},
    )[0]


@transaction.atomic
def claim():
    now = timezone.now()
    eligible = Q(status="pending", next_attempt_at__lte=now) | Q(
        status="running", lease_until__lte=now
    )
    job = Job.objects.select_for_update(skip_locked=True).filter(eligible).order_by("next_attempt_at", "pk").first()
    if job is None:
        return None
    if job.attempts >= MAX_ATTEMPTS:
        job.status = "failed"
        job.last_error = "lease_exhausted"
        job.finished_at = now
        job.lease_until = job.lease_token = None
    else:
        job.status = "running"
        job.attempts += 1
        job.lease_token = uuid.uuid4()
        job.lease_until = now + LEASE
    job.save(update_fields=["status", "attempts", "lease_token", "lease_until", "last_error", "finished_at"])
    return job


def execute(job):
    """The M2 handler checks a revision without accessing task content or providers."""
    membership = Membership.objects.filter(
        workspace_id=job.workspace_id, user_id=job.actor_id, user__is_active=True
    )
    if job.kind != PROBE:
        return "unknown_job"
    if not isinstance(job.payload, dict) or type(job.payload.get("revision")) is not int:
        return "invalid_job"
    revision = membership.values_list("workspace__revision", flat=True).first()
    if revision is None:
        return "authorization_revoked"
    if not 0 <= job.payload["revision"] <= revision:
        return "invalid_revision"
    return ""


def finish(job, error="", retry=False):
    now = timezone.now()
    retry = retry and job.attempts < MAX_ATTEMPTS
    updates = {
        "lease_token": None, "lease_until": None,
        "finished_at": None if retry else now, "last_error": error,
        "status": "pending" if retry else ("failed" if error else "done"),
    }
    if retry:
        updates["next_attempt_at"] = now + timedelta(seconds=2 ** job.attempts)
    return Job.objects.filter(
        pk=job.pk, status="running", lease_token=job.lease_token, lease_until__gt=now
    ).update(**updates) == 1


def run_one():
    job = claim()
    if job is None:
        return False
    if job.status == "running":
        try:
            error = execute(job)
        except OperationalError:
            finish(job, "database_unavailable", retry=True)
        else:
            finish(job, error)
    return True
