"""Confirm a scoped duplicate enqueue results in one successful real worker execution."""

import time
import uuid

import django

django.setup()
from core.models import Membership
from core.sync.jobs import enqueue_probe

owner = Membership.objects.select_related("user").filter(role="owner").first()
if owner is None:
    raise RuntimeError("Worker verification requires the disposable browser account.")
key = uuid.uuid4()
job = enqueue_probe(owner.user, owner.workspace_id, key)
if enqueue_probe(owner.user, owner.workspace_id, key).pk != job.pk:
    raise RuntimeError("Duplicate probe created a second job.")
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    job.refresh_from_db()
    if job.status == "failed":
        raise RuntimeError("Worker rejected its own owner's probe.")
    if job.status == "done" and job.attempts == 1:
        print("Scoped worker probe completed once.")
        break
    time.sleep(0.5)
else:
    raise RuntimeError("Worker did not finish its scoped probe in time.")
